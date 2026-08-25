/**
 * Resolves a host's pack-folder setting entries to absolute folder paths.
 * Pure (paths in, a base directory in, absolute paths out) so it is
 * unit-testable without a real workspace/vault.
 *
 * `baseDir` is deliberately a generic name: what it MEANS differs per host
 * (VS Code resolves a relative entry against the open workspace folder,
 * since `markii.packs` is a user-scoped setting; an Obsidian plugin
 * resolves it against the open vault, since its pack-folder list is a
 * device-local setting that can be opened against several vaults) but the
 * resolution RULE is identical, so only the base directory's identity is a
 * host concern — reading the setting itself, and naming what "relative"
 * means in a diagnostic message, stays in each host's own app code.
 *
 * DECISION (per orchestrator direction, carried over from the original VS
 * Code module this was hoisted from): a relative entry is resolved against
 * `baseDir` as given by the caller; an absolute entry is used as-is. This
 * matches how a user reads the setting's own description: "this pack
 * folder, relative to my project/vault".
 */
import * as path from 'node:path';

/**
 * Expands a leading `~` in `entry` against `homeDir` — `~` alone, or
 * `~/...`/`~\...` (both separators accepted regardless of host platform, so
 * a setting written on one OS still expands sensibly if synced to
 * another). Any other entry (including one that merely CONTAINS a `~`
 * elsewhere, or has no `homeDir` to expand against) passes through
 * unchanged. This is convenience, not path resolution: the result still
 * goes through the ordinary absolute/relative handling in
 * `resolvePackPaths` below, exactly like a path the user typed out in
 * full.
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
 * caller (each host's own `pack-context.ts`) passes `os.homedir()` itself.
 * Omitted (or `undefined`) disables `~` expansion entirely — a `~` entry is
 * then simply relative like any other.
 *
 * - A `~`/`~/...` entry is expanded against `homeDir` FIRST (`expandHome`)
 *   — this makes an absolute path pleasant to write, which matters because
 *   a relative entry can mean a different folder in every window/vault it
 *   happens to be open in, so an absolute (or `~`-relative) entry is the
 *   only spelling that means the same folder everywhere.
 * - An entry that is (now) already absolute passes through UNCHANGED —
 *   never re-rooted, and never rejected for pointing outside `baseDir`,
 *   since an absolute path is the user explicitly naming a folder wherever
 *   it is (docs/packs.md: packs are installed into the application, not
 *   jailed the way a bundle's contents are).
 * - A relative entry (still relative after `~` expansion) is joined
 *   against `baseDir` and NORMALIZED (`path.normalize` via `path.join`,
 *   which collapses `..` segments syntactically). A relative entry that
 *   climbs out of `baseDir` via `..` is intentionally still honored, for
 *   the same reason an absolute entry is: this setting is a user-authored
 *   trust decision, not a content-derived path that needs jailing — unlike
 *   a bundle's `scripts/`/`assets/` paths (`@markii/bundle`'s
 *   `normalizeBundlePath`), which DO get jailed because they come from
 *   potentially-hostile bundle content, not from the user directly editing
 *   their own settings.
 * - `baseDir === undefined` (no workspace/vault open) leaves every relative
 *   entry UNRESOLVED (returned as-is, unjoined) rather than guessing a
 *   base — a relative entry with nothing open cannot mean anything, so the
 *   caller's later folder-read simply fails to find a `pack.json` there
 *   and `discoverPacks` quietly skips it, the same cleanliness posture as
 *   any other unreadable folder.
 *
 * Never throws — every input is a configuration string a user typed by
 * hand, and a malformed one should degrade to "not found", not to a crash.
 */
export function resolvePackPaths(
  packs: readonly string[],
  baseDir: string | undefined,
  homeDir?: string,
): string[] {
  return packs.map((entry) => {
    const expanded = expandHome(entry, homeDir);
    if (path.isAbsolute(expanded)) return expanded;
    if (baseDir === undefined) return expanded;
    return path.join(baseDir, expanded);
  });
}

/**
 * The deprecation-detection half: the ORIGINAL (unexpanded) entries in
 * `packs` that are relative once `~` expansion is accounted for — i.e.
 * exactly the entries `resolvePackPaths` resolves against `baseDir` rather
 * than using as-is. A relative entry can silently mean a different folder
 * in every window/vault it happens to be open in, so a caller surfaces
 * these to its own diagnostics surface, in its own wording (each host
 * names its setting and the ambiguity differently — see this module's top
 * doc comment); `resolvePackPaths` keeps resolving them exactly as it
 * always has: this function only ever adds a warning, never changes
 * behavior.
 */
export function relativePackEntries(
  packs: readonly string[],
  homeDir?: string,
): string[] {
  return packs.filter((entry) => !path.isAbsolute(expandHome(entry, homeDir)));
}
