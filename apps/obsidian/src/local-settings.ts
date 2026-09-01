/**
 * DEVICE-LOCAL settings — everything that authorizes execution or network
 * access, or schedules either of those to happen without a click: run on
 * open, the scheduled-refresh interval, and the switch that turns script
 * execution off on this device entirely. See `src/run/local-storage-memento.ts`'s
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
  /**
   * GitHub issue #34: the device-level off switch for the whole Run path.
   * When it is `true`, no trigger runs a note's scripts on this device:
   * not the `run-markii-scripts` command, not `runOnOpen` above, not the
   * scheduled interval. Off by default, so nothing changes for anyone who
   * never touches it.
   *
   * It lives HERE rather than in `src/settings.ts` for the reason this
   * file exists: it decides whether code runs. A vault-synced copy would
   * mean one device's decision about executing scripts travelling to every
   * other device, and to anyone the vault is shared with, which is exactly
   * the class of setting `saveData` must never carry.
   *
   * It is not a security boundary and does not pretend to be one: the tier
   * gate, the grant model, and the isolate are what contain a script that
   * DOES run, and none of them change here. Turning this on leaves every
   * stored grant untouched, and turning it back off re-authorizes nothing
   * beyond what was already granted by hand.
   */
  readonly scriptsDisabled: boolean;
}

export const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  runOnOpen: false,
  refreshIntervalSeconds: 0,
  scriptsDisabled: false,
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
    scriptsDisabled:
      typeof raw.scriptsDisabled === 'boolean'
        ? raw.scriptsDisabled
        : DEFAULT_LOCAL_SETTINGS.scriptsDisabled,
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
