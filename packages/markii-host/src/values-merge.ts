/**
 * The one way a host folds a single arriving value into the value store its
 * preview is rendering from (GitHub issue #35).
 *
 * A run reports its values one at a time, in document order, while it is
 * still going. Each arrival has to replace exactly one name and leave every
 * other name exactly as it was — that is what makes the bound component go
 * fresh while the rest of the note stays visibly stale, instead of the
 * whole page flipping at the end of the batch.
 *
 * It lives here, in the shared host layer, because both hosts do it: the VS
 * Code webview folds a `value` wire message into its React state, and the
 * Obsidian view folds a callback's value into the store it re-renders from.
 * Two copies of a merge this small still drift, and the `__proto__` rule
 * below is exactly the kind of detail one copy would quietly lose.
 *
 * Environment-free on purpose (no `node:*`, no React), so it is exported
 * from `@markii/host/browser` as well as the main entry.
 */
import type { StoredValue } from '@markii/runtime';

/**
 * `values` with `name` set to `value`, as a NEW object — the input is never
 * mutated, so a caller holding the previous store (React state, a view's
 * last-rendered snapshot) can still compare against it.
 *
 * A name already present keeps its POSITION and takes the new value; a new
 * name is appended. Order is not semantically meaningful to a renderer, but
 * a store whose keys reshuffle on every value would make any diff of two
 * snapshots harder to read than it needs to be.
 *
 * Built through `Object.fromEntries` rather than `{...values, [name]: value}`
 * because a script may legitimately be named `__proto__` (docs/spec.md's
 * name grammar allows it): a computed assignment of that key hits
 * `Object.prototype`'s setter, which sets the object's prototype and
 * creates no own property at all, silently dropping the value. The same
 * guard is in `run/run-flow.ts`'s `mergePersistedValues` and
 * `run/stale-values.ts`, for the same reason.
 */
export function mergeArrivingValue(
  values: Readonly<Record<string, StoredValue>> | undefined,
  name: string,
  value: StoredValue,
): Record<string, StoredValue> {
  const entries: Array<[string, StoredValue]> = [];
  let replaced = false;
  for (const [key, existing] of Object.entries(values ?? {})) {
    if (key === name) {
      entries.push([key, value]);
      replaced = true;
      continue;
    }
    entries.push([key, existing]);
  }
  if (!replaced) entries.push([name, value]);
  return Object.fromEntries(entries);
}
