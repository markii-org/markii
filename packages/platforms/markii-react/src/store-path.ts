import type { ValueStatus, ValueStore } from '@markii/runtime';

/** What resolving a (possibly dotted) name against a `ValueStore` produces. */
export interface StorePathResolution {
  value: unknown;
  status: ValueStatus;
  /** The root entry's error message, if it has one — carried through regardless of how the rest of the path resolved, matching what callers read off a plain `store.get(name)` today. */
  error?: string;
}

const MISSING: StorePathResolution = { value: undefined, status: 'missing' };

/**
 * Resolves a `data=`/`:value[]` name against `store`, walking a dotted path
 * (`repo.stars`) into whatever object/array the root name's stored value
 * turns out to be (DESIGN.md §8: `data=<name>` / `:value[<name>]`). A bare
 * name with no dot (`stars`) behaves exactly as a direct `store.get(name)`
 * always has — this is a superset, not a new mode.
 *
 * Walk rules, checked at every segment after the first:
 * - The current value must be a non-null `object` (arrays included — a
 *   numeric segment like `spark.0` indexes an array the same way a named
 *   segment indexes a plain object, since both are just `Object.hasOwn`
 *   checks).
 * - `Object.hasOwn(current, segment)` must hold. This is the load-bearing
 *   guard: it is what keeps `repo.__proto__` / `repo.constructor` / any
 *   other inherited `Object.prototype` member from ever resolving through
 *   the prototype chain as if it were real stored data — the same defense
 *   `createRegistry`/`createValueStore` already apply to name lookups
 *   elsewhere in this codebase. A plain object literal has no *own*
 *   `__proto__`/`constructor` property, so this check rejects both without
 *   needing to special-case either name.
 * - An empty segment (`a..b`, or a leading/trailing `.`) never resolves —
 *   treated the same as an unknown segment.
 *
 * The root segment itself is resolved via `store.get`, unaffected by any of
 * the above (a store name is an opaque string, not itself walked).
 *
 * Never throws. An absent store, an absent root name, or any failed
 * segment all degrade to `{ value: undefined, status: 'missing' }` — the
 * same graceful-degradation contract `data=`/`:value[]` already promise for
 * a plain missing name. Only a path that resolves *in full* reports the
 * root entry's own status (`fresh`/`stale`/`error`/`missing`); a partial
 * failure partway through the path is always reported as `missing`, never
 * as whatever the root's own status happened to be.
 */
export function resolveStorePath(
  store: ValueStore | undefined,
  dottedName: string,
): StorePathResolution {
  const segments = dottedName.split('.');
  const root = segments[0];
  if (!root) return MISSING;

  const entry = store?.get(root);
  if (!entry) return MISSING;

  let current: unknown = entry.value;
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (
      !segment ||
      current === null ||
      typeof current !== 'object' ||
      !Object.hasOwn(current, segment)
    ) {
      return { value: undefined, status: 'missing', error: entry.error };
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return { value: current, status: entry.status, error: entry.error };
}
