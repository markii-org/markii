/**
 * Pure helpers for the preview panel's local-resource-root bookkeeping —
 * the host side of relative image loading (`preview-panel.ts`).
 *
 * A webview's `localResourceRoots` is FIXED at panel creation: VS Code gives
 * no way to widen it later. The preview panel, however, follows the active
 * editor across documents, and a document in a folder no root covers cannot
 * load the images sitting next to it. `preview-panel.ts` therefore records
 * the roots a panel was created with and, on every retarget, asks
 * `isCoveredByRoots` whether the new document's folder is already reachable
 * — recreating the panel (the only way to widen the set) just for the rare
 * case where it is not.
 *
 * These functions compare `scheme://authority/path` keys as strings. That is
 * a COARSE, conservative check used only to decide whether recreating the
 * panel is necessary — VS Code's own resource jail, not this module, is what
 * actually enforces which files a webview may load. A false negative
 * (case-differing paths on a case-insensitive file system, say) costs one
 * unnecessary panel recreation and nothing else; a false positive costs an
 * image that does not load, exactly as if this file did not exist.
 *
 * Kept `vscode`-free (plain strings in, plain values out) so it is
 * unit-testable — vitest cannot resolve the `vscode` module at all.
 */

/**
 * `value` with exactly one trailing `/`. Used to turn a directory URI into a
 * base URI: `new URL('nice.png', '…/notes')` would resolve against `notes`'s
 * PARENT (the last path segment of a base is treated as a file name), while
 * `new URL('nice.png', '…/notes/')` correctly resolves inside `notes`.
 */
export function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

/** `value` with every trailing `/` removed, except when the whole value is `/` (or a run of them) — a bare root keeps one separator. */
function withoutTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 1 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

/**
 * True when `candidate` is `root` itself or lives underneath it. The
 * comparison is segment-aware — `/home/user` does NOT cover
 * `/home/username` — because the prefix tested always ends at a `/`
 * boundary. Empty strings never match: an unknown location is treated as
 * uncovered rather than universally covered.
 */
export function isWithinRoot(root: string, candidate: string): boolean {
  if (root === '' || candidate === '') return false;
  const normalizedRoot = withoutTrailingSlash(root);
  const normalizedCandidate = withoutTrailingSlash(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(withTrailingSlash(normalizedRoot));
}

/** True when any one of `roots` covers `candidate` (see `isWithinRoot`). An empty root list covers nothing. */
export function isCoveredByRoots(
  roots: readonly string[],
  candidate: string,
): boolean {
  return roots.some((root) => isWithinRoot(root, candidate));
}

/**
 * The `localResourceRoots` a preview panel needs to load every installed
 * pack's registration script (`preview-panel.ts`'s `localResourceRootsFor`
 * calls this): each pack's own folder (where a prebuilt `webview.js` sits,
 * per `./packs/discover.ts`'s `scriptPath`), UNION the shared,
 * extension-owned cache directory a compiled script may live under instead
 * (`@markii/host`'s `packs/pack-build.ts`, GitHub issue #3's compile-from-source slice) —
 * that directory sits OUTSIDE every configured pack folder (AGENTS.md's
 * cleanliness rule: never written into the user's own pack folder), so it
 * needs its own root or a compiled script's `<script src=...>` tag would
 * be refused by the webview's resource jail.
 *
 * `cacheDir` is `undefined` whenever the caller has none configured (or
 * nothing was ever compiled) — then this is just `packFolders`,
 * deduplicated, unchanged from before this function existed. Plain strings
 * in and out, `vscode`-free: `preview-panel.ts` maps every entry through
 * `vscode.Uri.file(...)` itself.
 */
export function packWebviewRoots(
  packFolders: readonly string[],
  cacheDir: string | undefined,
): string[] {
  const roots = [...packFolders];
  if (cacheDir !== undefined) roots.push(cacheDir);
  return [...new Set(roots)];
}
