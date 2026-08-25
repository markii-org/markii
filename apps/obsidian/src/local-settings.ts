/**
 * DEVICE-LOCAL settings — everything that authorizes execution or network
 * access, or schedules either of those to happen without a click: run on
 * open, and the scheduled-refresh interval. See `src/run/local-storage-memento.ts`'s
 * top comment for the full rule this file exists to serve, and
 * `src/settings.ts`'s PERSISTENCE TIER note for the contrast with the
 * ordinary, vault-synced `saveData`-backed settings.
 *
 * `MarkiiPlugin` (`src/main.ts`) persists this shape with
 * `app.saveLocalStorage`/`app.loadLocalStorage` — device-local, never synced
 * or shared with a vault — NEVER with `loadData`/`saveData`. Deliberately
 * `obsidian`-free (like `src/settings.ts`) so the shape and its hostile-input
 * normalization stay unit-testable without the `obsidian` module.
 */

/** The `app.saveLocalStorage`/`loadLocalStorage` key this shape lives under. */
export const LOCAL_SETTINGS_STORAGE_KEY = 'markii:localSettings';

/** Mirrors `apps/vscode/src/refresh-interval.ts`'s constant of the same name: a positive scheduled-refresh interval below this is clamped up to it, never silently rejected. */
export const MIN_REFRESH_INTERVAL_SECONDS = 5;

export interface LocalSettings {
  /**
   * GitHub issue #11's run-on-open, ported to this host: an at-most-once
   * `'auto'`-trigger (read-only tier) run performed the first time a note's
   * preview opens in a session. Off by default.
   */
  readonly runOnOpen: boolean;
  /**
   * Scheduled-refresh interval, in whole seconds. `0` (the default) means
   * off. A positive value is clamped up to `MIN_REFRESH_INTERVAL_SECONDS`
   * by `refreshIntervalMsFromSeconds` below when a view actually schedules
   * a timer — this stored value is never silently rewritten just because
   * it was typed low.
   */
  readonly refreshIntervalSeconds: number;
}

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  runOnOpen: false,
  refreshIntervalSeconds: 0,
};

/**
 * Normalizes whatever `app.loadLocalStorage(LOCAL_SETTINGS_STORAGE_KEY)`
 * handed back into a well-formed `LocalSettings` — hostile-shape-guarded the
 * same way `src/settings.ts`'s `normalizeSettings` guards `loadData()`'s
 * `any` return, since this is also hand-editable, foreign-version-shaped
 * data in principle.
 */
export function normalizeLocalSettings(data: unknown): LocalSettings {
  if (typeof data !== 'object' || data === null) {
    return { ...DEFAULT_LOCAL_SETTINGS };
  }
  const raw = data as Record<string, unknown>;
  const refreshIntervalSeconds =
    typeof raw.refreshIntervalSeconds === 'number' &&
    Number.isFinite(raw.refreshIntervalSeconds) &&
    raw.refreshIntervalSeconds >= 0
      ? raw.refreshIntervalSeconds
      : DEFAULT_LOCAL_SETTINGS.refreshIntervalSeconds;
  return {
    runOnOpen:
      typeof raw.runOnOpen === 'boolean'
        ? raw.runOnOpen
        : DEFAULT_LOCAL_SETTINGS.runOnOpen,
    refreshIntervalSeconds,
  };
}

/**
 * The scheduled-refresh interval in milliseconds a view should actually run
 * its timer at, or `undefined` when refresh is off (`seconds` is `0` or any
 * non-positive/invalid value). A positive value below
 * `MIN_REFRESH_INTERVAL_SECONDS` is clamped up to it — mirrors
 * `apps/vscode/src/preview-panel.ts`'s `refreshIntervalMs`.
 */
export function refreshIntervalMsFromSeconds(
  seconds: number,
): number | undefined {
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return undefined;
  }
  return Math.max(seconds, MIN_REFRESH_INTERVAL_SECONDS) * 1000;
}
