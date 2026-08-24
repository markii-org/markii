/**
 * Resolves the `markii.packs` setting's entries to absolute folder paths.
 * `vscode`-free and pure (paths in, `workspaceRoot` in, absolute paths out)
 * so it is unit-testable without a real workspace.
 *
 * DECISION (per orchestrator direction): a relative entry is resolved
 * against the WORKSPACE FOLDER — the opened folder
 * (`vscode.workspace.workspaceFolders[0]`, in the single-root case this
 * extension supports) — never against the extension's own install
 * directory or wherever `settings.json` happens to live. An absolute entry
 * is used as-is. This matches how a user reads the setting's own
 * description: "this pack folder, relative to my project".
 */
import * as path from 'node:path';

/**
 * Resolves each entry in `packs` to an absolute path.
 *
 * - An entry that is already absolute (`path.isAbsolute`) passes through
 *   UNCHANGED — never re-rooted, and never rejected for pointing outside
 *   the workspace, since an absolute path is the user explicitly naming a
 *   folder wherever it is (docs/packs.md: packs are installed into the
 *   application, which here means "wherever the user's `markii.packs`
 *   setting points", not vault-jailed the way a bundle's contents are).
 * - A relative entry is joined against `workspaceRoot` and NORMALIZED
 *   (`path.normalize` via `path.join`, which collapses `..` segments
 *   syntactically). A relative entry that climbs out of the workspace root
 *   via `..` is intentionally still honored, for the same reason an
 *   absolute entry is: this setting is a user-authored trust decision, not
 *   a content-derived path that needs jailing — unlike a bundle's
 *   `scripts/`/`assets/` paths (`@markii/bundle`'s `normalizeBundlePath`),
 *   which DO get jailed because they come from potentially-hostile bundle
 *   content, not from the user directly editing their own settings.
 * - `workspaceRoot === undefined` (no workspace folder open) leaves every
 *   relative entry UNRESOLVED (returned as-is, unjoined) rather than
 *   guessing a base — a relative `markii.packs` entry with no workspace
 *   open cannot mean anything, so the caller's later folder-read simply
 *   fails to find a `pack.json` there and `discoverPacks` quietly skips it,
 *   the same cleanliness posture as any other unreadable folder.
 *
 * Never throws — every input is a configuration string a user typed by
 * hand, and a malformed one should degrade to "not found", not to a crash.
 */
export function resolvePackPaths(
  packs: readonly string[],
  workspaceRoot: string | undefined,
): string[] {
  return packs.map((entry) => {
    if (path.isAbsolute(entry)) return entry;
    if (workspaceRoot === undefined) return entry;
    return path.join(workspaceRoot, entry);
  });
}
