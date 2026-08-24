/**
 * The tiny, vscode-free transform that turns a document's PERSISTED value
 * store (`./run-flow.ts`'s `readPersistedValues`) into the value store the
 * host re-posts to the webview when a note is (re)opened — GitHub issue #11,
 * gap 1. "Opening a note ... showing its last data marked as stale where
 * appropriate" (docs/spec.md, docs/scripting.md): a reopened monitoring note
 * renders its last figures instantly and offline, visibly stale, before (or
 * without) any re-run.
 *
 * The only transform is on `status`: a value that was `'fresh'` becomes
 * `'stale'` (it is last-known data, not the product of the current session's
 * run); a value that is already `'stale'` stays stale; an `'error'`/
 * `'missing'` value is left untouched (there is nothing usable to mark
 * stale — the consuming component shows its own error/empty state). Every
 * other field is passed through verbatim, and the raw `error` text was
 * already stripped before these values were ever persisted
 * (`./run-flow.ts`'s `scrubValuesForWire`), so this never has to scrub again.
 */
import type { StoredValue, ValueStatus } from '@markii/runtime';

/** The `status` a persisted value is shown with on rehydration — `'fresh'` demotes to `'stale'`; everything else is unchanged. */
function staleStatus(status: ValueStatus): ValueStatus {
  return status === 'fresh' ? 'stale' : status;
}

/**
 * A copy of `persisted` with every `'fresh'` value demoted to `'stale'` —
 * see this module's doc comment. Returns a fresh object; never mutates the
 * input (which may be the caller's live persisted snapshot).
 */
export function staleValuesForRehydration(
  persisted: Record<string, StoredValue>,
): Record<string, StoredValue> {
  const entries: Array<[string, StoredValue]> = [];
  for (const [name, value] of Object.entries(persisted)) {
    // A persisted store is only guarded down to "plain object" when it is
    // read back (`./run-flow.ts`'s `isStoredValueRecord`), so a corrupt or
    // foreign ENTRY reaches here unchecked. Reading `.status` off a `null`
    // entry would throw, and this transform runs on the host before the
    // protocol guard ever sees the values, so the throw would land in the
    // rehydration path rather than being rejected on the wire. Skip an
    // unusable entry instead: a value that cannot be understood is exactly
    // a value with nothing to re-show.
    if (typeof value !== 'object' || value === null) continue;
    entries.push([name, { ...value, status: staleStatus(value.status) }]);
  }
  // `Object.fromEntries`, not `out[name] = ...`: a plain assignment of the
  // name `__proto__` hits `Object.prototype`'s setter, which sets the
  // object's prototype and creates NO own property, silently dropping that
  // value. `__proto__` is a legal script name (docs/spec.md's
  // `[A-Za-z_][A-Za-z0-9_-]*`), so this is reachable from an ordinary note.
  // `fromEntries` defines each key as an own property, `__proto__` included.
  return Object.fromEntries(entries);
}
