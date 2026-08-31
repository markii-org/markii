/**
 * What an `<img src>` written in a note MEANS in this vault.
 *
 * Two features need this answer and must never disagree about it: the
 * preview, which rewrites a note's image sources to URLs Obsidian can serve
 * (`./preview-images.ts`), and the export, which embeds the same images as
 * `data:` URIs (`./export/export-images.ts`). Before this module they were
 * one implementation and one absence, which is how
 * `:::figure{src="./test_image.png"}` could export correctly and still show
 * a broken image in the preview. The path interpretation now lives here,
 * once, and both sides walk the same ordered list of candidates.
 *
 * THE ORDER, and why it is this one:
 *
 * 1. Note-relative. `./test_image.png`, `test_image.png`, and
 *    `../shared/logo.png` are resolved against the folder the note itself
 *    sits in. This is what a writer means by a relative path, and it is
 *    decided here rather than left to the link index, so a file sitting
 *    next to the note always wins.
 * 2. Obsidian's own linkpath resolution, `getFirstLinkpathDest`. This is
 *    what makes a shortest-path reference behave the way `[[image]]` does
 *    everywhere else in the app: a bare file name finds the file wherever
 *    it lives in the vault.
 * 3. Vault-relative. A path read from the vault root, which is how
 *    `/assets/logo.png` and `assets/logo.png` are commonly written in a
 *    vault with a single asset folder.
 *
 * A source that carries a scheme is never touched. `https:`, `data:`, a
 * protocol-relative `//host/…`, a bare `#fragment`, and a Windows drive
 * path all resolve on their own or are not paths at all, and rewriting them
 * would only break them. The scheme test is the same one `@markii/core`'s
 * `isSafeUrl` uses, so a path that merely contains a colon later on stays a
 * path.
 *
 * THE JAIL. There is deliberately no path jail here. Every candidate this
 * produces is handed to Obsidian's own vault APIs, which are jailed to the
 * vault by construction: `getFirstLinkpathDest` searches the link index,
 * and the vault adapter cannot read outside the folder it was handed. A
 * traversal attempt simply resolves to nothing and the source is left as
 * written. What this module does guarantee is that it never emits a
 * candidate that could be read as an absolute filesystem path: a `..` that
 * would climb above the vault root drops the candidate, and
 * `isVaultRelativePath` is the check the callers apply before handing a
 * resolved path to the vault.
 */

/** One place to look for a source, in the order `vaultImageCandidates` returns them. `linkpath` is a question for `getFirstLinkpathDest`; `path` is a vault-relative path to test for existence. */
export type VaultImageCandidate =
  | { readonly kind: 'linkpath'; readonly value: string }
  | { readonly kind: 'path'; readonly value: string };

/**
 * True when `value` begins with a URL scheme, using the same "text before
 * the first colon, but only when that colon precedes any `/`, `?` or `#`"
 * rule as `@markii/core`'s `isSafeUrl` and
 * `apps/vscode/src/webview/document-images.ts` — so `notes/a:b.png` is
 * correctly treated as a path, while `data:…` and `C:\pictures\a.png` are
 * not.
 */
function hasScheme(value: string): boolean {
  const colon = value.indexOf(':');
  if (colon === -1) return false;

  const slash = value.indexOf('/');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  return (
    (slash === -1 || colon < slash) &&
    (questionMark === -1 || colon < questionMark) &&
    (numberSign === -1 || colon < numberSign)
  );
}

/**
 * True when `src` is a source this host should try to resolve against the
 * vault at all. False for everything that already resolves on its own or is
 * not a vault path: an empty source, a bare fragment, a protocol-relative
 * URL, anything carrying a scheme, and a UNC path.
 */
export function isResolvableImageSource(src: string): boolean {
  if (src.trim() === '') return false;
  if (src.startsWith('#')) return false;
  if (src.startsWith('//')) return false;
  if (src.startsWith('\\')) return false;
  return !hasScheme(src);
}

/**
 * True when `path` is safe to hand to a vault API: a non-empty relative
 * path that cannot be read as an absolute filesystem path. The callers
 * apply this to whatever a resolution step hands back, so a resolver that
 * ever returned an absolute path could not turn into a read outside the
 * vault.
 */
export function isVaultRelativePath(path: string): boolean {
  if (path === '') return false;
  if (path.startsWith('/')) return false;
  if (path.startsWith('\\')) return false;
  return !hasScheme(path);
}

/** The folder part of `notePath`, or `''` for a note at the vault root. */
export function noteFolderPath(notePath: string): string {
  const lastSlash = notePath.lastIndexOf('/');
  return lastSlash === -1 ? '' : notePath.slice(0, lastSlash);
}

/**
 * `path` reduced to a plain vault-relative path: `.` segments and empty
 * segments dropped, `..` applied, a leading `/` removed with it.
 * `undefined` when the path climbs above the vault root, which drops the
 * candidate rather than clamping it, so a traversal attempt resolves to
 * nothing instead of to some other file.
 */
export function normalizeVaultPath(path: string): string | undefined {
  const result: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (result.length === 0) return undefined;
      result.pop();
      continue;
    }
    result.push(segment);
  }
  return result.length === 0 ? undefined : result.join('/');
}

/**
 * The forms of `src` worth looking for: the source as written, plus its
 * percent-decoded form when that differs. Markdown carries a space as
 * `%20`, so `![](my%20image.png)` has to be looked up as `my image.png`;
 * a file whose name really contains a percent sign is still found by the
 * raw form, which is why both are tried rather than one replacing the
 * other.
 */
function sourceForms(src: string): string[] {
  if (!src.includes('%')) return [src];
  try {
    const decoded = decodeURIComponent(src);
    return decoded === src ? [src] : [src, decoded];
  } catch {
    return [src];
  }
}

/**
 * Every place `src`, written in the note at `notePath`, could name, in the
 * order described at the top of this file. Empty for a source that must be
 * left exactly as written.
 */
export function vaultImageCandidates(
  src: string,
  notePath: string,
): VaultImageCandidate[] {
  if (!isResolvableImageSource(src)) return [];

  const forms = sourceForms(src);
  const folder = noteFolderPath(notePath);
  const candidates: VaultImageCandidate[] = [];

  for (const form of forms) {
    // A leading `/` says "from the vault root" out loud, so it never gets a
    // note-relative reading.
    if (form.startsWith('/')) continue;
    const noteRelative = normalizeVaultPath(
      folder === '' ? form : `${folder}/${form}`,
    );
    if (noteRelative !== undefined) {
      candidates.push({ kind: 'path', value: noteRelative });
    }
  }

  for (const form of forms) {
    candidates.push({ kind: 'linkpath', value: form });
  }

  for (const form of forms) {
    const vaultRelative = normalizeVaultPath(form);
    if (vaultRelative !== undefined) {
      candidates.push({ kind: 'path', value: vaultRelative });
    }
  }

  return candidates.filter(
    (candidate, index) =>
      candidates.findIndex(
        (other) =>
          other.kind === candidate.kind && other.value === candidate.value,
      ) === index,
  );
}
