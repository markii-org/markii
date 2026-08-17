import type { ValueStatus, ValueStore, VaultStore } from '@markii/runtime';

/** What resolving a (possibly dotted) name against a `ValueStore` produces. */
export interface StorePathResolution {
  value: unknown;
  status: ValueStatus;
  /** The root entry's error message, if it has one — carried through regardless of how the rest of the path resolved, matching what callers read off a plain `store.get(name)` today. */
  error?: string;
}

const MISSING: StorePathResolution = { value: undefined, status: 'missing' };

/**
 * The one-character prefix that routes a `data=`/`:value[]` name at the
 * vault store instead of the note store (DESIGN.md §8, "Vault-published
 * values"): "Readers use an `@` prefix ... The whole mental model is one
 * sentence: bare name = mine, `@name` = the vault's."
 */
export const VAULT_NAME_PREFIX = '@';

/**
 * Where a `resolveScopedPath` lookup may read from: the note-local
 * `ValueStore` for a bare name, the app-scoped `VaultStore` for an
 * `@`-prefixed name. Either half may be absent — an absent `vault` degrades
 * every `@name` to `missing` without ever falling back to `store`, and vice
 * versa, preserving the scope boundary the whole mental model rests on.
 */
export interface ValueScope {
  store?: ValueStore;
  vault?: VaultStore;
}

/**
 * Walks `segments[1:]` into `current`, exactly as `resolveStorePath` always
 * has — shared by both entry points so the `Object.hasOwn` prototype-chain
 * guard can never diverge between the note-local and vault-scoped resolvers
 * (a divergence there would be a security bug, not just a bug).
 *
 * Walk rules, checked at every segment after the first:
 * - The current value must be a non-null `object` (arrays included — a
 *   numeric segment like `spark.0` indexes an array the same way a named
 *   segment indexes a plain object, since both are just `Object.hasOwn`
 *   checks).
 * - `Object.hasOwn(current, segment)` must hold. This is the load-bearing
 *   guard: it is what keeps `repo.__proto__` / `repo.constructor` / any
 *   other inherited `Object.prototype` member from ever resolving through
 *   the prototype chain as if it were real stored data.
 * - An empty segment (`a..b`, or a leading/trailing `.`) never resolves —
 *   treated the same as an unknown segment.
 */
function walkSegments(
  entry: { value: unknown; status: ValueStatus; error?: string },
  segments: readonly string[],
): StorePathResolution {
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

/**
 * Resolves a `data=`/`:value[]` name against `store`, walking a dotted path
 * (`repo.stars`) into whatever object/array the root name's stored value
 * turns out to be (DESIGN.md §8: `data=<name>` / `:value[<name>]`). A bare
 * name with no dot (`stars`) behaves exactly as a direct `store.get(name)`
 * always has — this is a superset, not a new mode.
 *
 * The root segment itself is resolved via `store.get`, unaffected by the
 * walk rules documented on `walkSegments` (a store name is an opaque
 * string, not itself walked).
 *
 * Never throws. An absent store, an absent root name, or any failed
 * segment all degrade to `{ value: undefined, status: 'missing' }` — the
 * same graceful-degradation contract `data=`/`:value[]` already promise for
 * a plain missing name. Only a path that resolves *in full* reports the
 * root entry's own status (`fresh`/`stale`/`error`/`missing`); a partial
 * failure partway through the path is always reported as `missing`, never
 * as whatever the root's own status happened to be.
 *
 * This is the note-local resolver — it never routes an `@`-prefixed name to
 * the vault; see `resolveScopedPath` for that.
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

  return walkSegments(entry, segments);
}

/**
 * Resolves a `data=`/`:value[]` name against a `ValueScope`, routing an
 * `@`-prefixed name (`@gh.stars`) at `scope.vault` instead of `scope.store`
 * (DESIGN.md §8: "bare name = mine, `@name` = the vault's"). Exactly one
 * leading `@` is stripped before the remainder is resolved — `@@gh` looks
 * up the literal vault name `@gh` (which simply misses), never loop-strips.
 * A bare `@` (empty root after stripping) is `missing` without ever
 * performing a vault lookup with an empty key.
 *
 * An `@`-name resolved with no `scope.vault` configured degrades to
 * `missing` and never falls back to `scope.store` — a note-local `gh` must
 * never satisfy `@gh`, since that would silently cross the scope boundary
 * the whole mental model rests on. The dotted-path walk after the root
 * shares `walkSegments` with `resolveStorePath`, so the `Object.hasOwn`
 * prototype-chain guard is identical in both scopes.
 *
 * Never throws.
 */
export function resolveScopedPath(
  scope: ValueScope,
  dottedName: string,
): StorePathResolution {
  if (dottedName.startsWith(VAULT_NAME_PREFIX)) {
    const remainder = dottedName.slice(VAULT_NAME_PREFIX.length);
    const segments = remainder.split('.');
    const root = segments[0];
    if (!root) return MISSING;

    const entry = scope.vault?.get(root);
    if (!entry) return MISSING;

    return walkSegments(entry, segments);
  }

  return resolveStorePath(scope.store, dottedName);
}
