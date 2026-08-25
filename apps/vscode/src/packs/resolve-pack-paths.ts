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
 * Expands a leading `~` in `entry` against `homeDir` — `~` alone, or
 * `~/...`/`~\...` (both separators accepted regardless of host platform, so
 * a setting written on one OS still expands sensibly if synced to another).
 * Any other entry (including one that merely CONTAINS a `~` elsewhere, or
 * has no `homeDir` to expand against) passes through unchanged. This is
 * convenience, not path resolution: the result still goes through the
 * ordinary absolute/relative handling in `resolvePackPaths` below, exactly
 * like a path the user typed out in full.
 */
function expandHome(entry: string, homeDir: string | undefined): string {
  if (homeDir === undefined) return entry;
  if (entry === '~') return homeDir;
  if (entry.startsWith('~/') || entry.startsWith('~\\')) {
    return path.join(homeDir, entry.slice(2));
  }
  return entry;
}

/**
 * Resolves each entry in `packs` to an absolute path. `homeDir` is a plain
 * parameter (not read via `os.homedir()` internally) so this stays testable
 * against a fixed value instead of the real host's home directory; the real
 * caller (`./pack-context.ts`'s `loadPackContext`) passes `os.homedir()`
 * itself. Omitted (or `undefined`) disables `~` expansion entirely — a `~`
 * entry is then simply relative like any other, matching this function's
 * behavior before ITEM 4 added the expansion.
 *

 * - A `~`/`~/...` entry is expanded against `homeDir` FIRST (`expandHome`),
 *   ITEM 4's convenience addition — this makes an absolute path pleasant to
 *   write, which matters because `markii.packs` is a USER-scoped (global)
 *   setting: a relative entry means a different folder in every workspace
 *   window it happens to be open in, so an absolute (or `~`-relative) entry
 *   is the only spelling that means the same folder everywhere.
 * - An entry that is (now) already absolute passes through UNCHANGED —
 *   never re-rooted, and never rejected for pointing outside the
 *   workspace, since an absolute path is the user explicitly naming a
 *   folder wherever it is (docs/packs.md: packs are installed into the
 *   application, which here means "wherever the user's `markii.packs`
 *   setting points", not vault-jailed the way a bundle's contents are).
 * - A relative entry (still relative after `~` expansion) is joined
 *   against `workspaceRoot` and NORMALIZED (`path.normalize` via
 *   `path.join`, which collapses `..` segments syntactically). A relative
 *   entry that climbs out of the workspace root via `..` is intentionally
 *   still honored, for the same reason an absolute entry is: this setting
 *   is a user-authored trust decision, not a content-derived path that
 *   needs jailing — unlike a bundle's `scripts/`/`assets/` paths
 *   (`@markii/bundle`'s `normalizeBundlePath`), which DO get jailed
 *   because they come from potentially-hostile bundle content, not from
 *   the user directly editing their own settings.
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
  homeDir?: string,
): string[] {
  return packs.map((entry) => {
    const expanded = expandHome(entry, homeDir);
    if (path.isAbsolute(expanded)) return expanded;
    if (workspaceRoot === undefined) return expanded;
    return path.join(workspaceRoot, expanded);
  });
}

/**
 * ITEM 4's deprecation-detection half: the ORIGINAL (unexpanded) entries in
 * `packs` that are relative once `~` expansion is accounted for — i.e.
 * exactly the entries `resolvePackPaths` resolves against `workspaceRoot`
 * rather than using as-is. `markii.packs` is USER-scoped (global), so a
 * relative entry silently means a different folder in every workspace
 * window it happens to be open in — the caller (`./pack-context.ts`'s
 * `loadPackContext`) surfaces these to the diagnostics output channel
 * (`preview-panel.ts`'s `logPackDiagnostics`) naming each one, while
 * `resolvePackPaths` keeps resolving them exactly as it always has: this
 * function only ever adds a warning, never changes behavior.
 */
export function relativePackEntries(
  packs: readonly string[],
  homeDir?: string,
): string[] {
  return packs.filter((entry) => !path.isAbsolute(expandHome(entry, homeDir)));
}
