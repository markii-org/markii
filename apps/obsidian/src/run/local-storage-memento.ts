/**
 * THE RULE THAT MATTERS MOST (task brief, "Storage"): `Plugin.saveData`
 * writes into `.obsidian/plugins/markii/data.json`, which lives INSIDE the
 * vault. It therefore travels with Obsidian Sync and with any vault someone
 * shares, clones, or hands to a colleague. Anything that authorizes
 * execution or network access — every one of `@markii/host`'s
 * `GrantMemento`-backed stores (network grants, the run cache, last-known
 * values, the last-run trace) — MUST instead use `app.saveLocalStorage` /
 * `app.loadLocalStorage`, which is device-local and does not travel.
 * Getting this wrong hands a recipient authority they never granted:
 * opening a shared or synced vault would silently carry someone else's
 * "yes, this note may talk to that host" decision along with it.
 *
 * This module is the ONE adapter between `@markii/host`'s `GrantMemento`
 * interface (the shape `runOnce`/`runGrantFlow`/`writeLastRunTrace` all
 * take) and Obsidian's local-storage pair — deliberately `obsidian`-free
 * (per this plugin's file-scope split, `src/obsidian-import-guard.test.ts`)
 * so `load`/`save` arrive as plain functions from `src/view.tsx`
 * (`app.loadLocalStorage.bind(app)` / `app.saveLocalStorage.bind(app)`),
 * and this file itself stays unit-testable with a plain in-memory fake.
 *
 * `src/storage-boundary.test.ts` is the executable half of this rule: it
 * fails the suite if any run/grant-path source file ever calls
 * `saveData`/`loadData` directly.
 */
import type { GrantMemento, Thenable } from '@markii/host';

/**
 * Reported when a write is refused. `localStorage` is the backing store, so
 * a full one is a real, reachable state rather than a theoretical error:
 * `@markii/host` caps a document's run cache and its last-known values at
 * 1 MB each, and a browser origin typically allows about 5 MB in total, so
 * a handful of dashboard notes can fill it.
 */
export type MementoWriteFailure = (key: string, error: unknown) => void;

/**
 * Builds a `GrantMemento` backed by `load`/`save` — call these with
 * `app.loadLocalStorage`/`app.saveLocalStorage` (bound) at the call site,
 * never `loadData`/`saveData`. `saveLocalStorage`'s own contract clears an
 * entry when given `null`; `update`'s `value === undefined` (this
 * package's own "nothing to persist" convention, e.g. an empty run cache)
 * is mapped to that `null` so a cleared value round-trips as "not present"
 * rather than as the literal string `"undefined"`.
 */
export function createLocalStorageMemento(
  load: (key: string) => unknown,
  save: (key: string, value: unknown) => void,
  onWriteFailure?: MementoWriteFailure,
): GrantMemento {
  return {
    get<T>(key: string, defaultValue?: T): T {
      // A read must not be able to break a run either: a corrupt or
      // unparseable entry degrades to the default, the same posture
      // `staleValuesForRehydration` takes for a corrupt persisted value.
      let raw: unknown;
      try {
        raw = load(key);
      } catch {
        return defaultValue as T;
      }
      return (raw === null || raw === undefined ? defaultValue : raw) as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      // NEVER throw. A refused write (a full `localStorage` throws
      // `QuotaExceededError`) must degrade to "this run's values were not
      // persisted", not to a failed run: persistence is a convenience, and
      // losing it should never cost the user the run they asked for. The
      // failure is reported so it reaches the host's diagnostics rather
      // than vanishing, per AGENTS.md's "clean is not silent".
      try {
        save(key, value === undefined ? null : value);
      } catch (error) {
        onWriteFailure?.(key, error);
      }
      return Promise.resolve();
    },
  };
}
