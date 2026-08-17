import type {
  FailureKind,
  StoredValue,
  ValueStatus,
  ValueStore,
  VaultStore,
} from '@markii/runtime';
import { describeHostFault } from './safe-data.js';

/** What resolving a (possibly dotted) name against a `ValueStore` produces. */
export interface StorePathResolution {
  value: unknown;
  status: ValueStatus;
  /** The root entry's error message, if it has one — carried through regardless of how the rest of the path resolved, matching what callers read off a plain `store.get(name)` today. Also the channel a HOST-STORE FAULT reports through (see `hostFault`). Always a `string` when present: a non-string `error` on a hand-built or hostile entry is dropped here rather than passed on to a `title=` attribute. */
  error?: string;
  /**
   * The root entry's `failureKind` (`@markii/runtime`'s closed `FailureKind`
   * union), carried through EXACTLY the way `error` already is (see
   * `walkSegments`): present whenever the root entry itself carried one —
   * regardless of whether the rest of the dotted path resolved in full or
   * degraded to `'missing'` partway through, mirroring `error`'s existing
   * carry-through rule so the two fields can never diverge. Absent when the
   * root entry didn't carry one (a hand-constructed fixture or a
   * pre-taxonomy stored value may not), and absent for a host-store fault —
   * a store that throws is not a classified script failure, so no kind is
   * ever invented for it. A component reading this must still degrade
   * gracefully when it's absent.
   *
   * Only ever a `string` at runtime (an out-of-taxonomy string still passes
   * through, exactly as before — `./components/failure-presentation` is the
   * closed-set gate for presentation); a non-string value on a hostile entry
   * is dropped here, since `Object.hasOwn(map, kind)` and
   * `` `${base}--${kind}` `` downstream would both coerce it and could throw.
   */
  failureKind?: FailureKind;
}

const MISSING: StorePathResolution = { value: undefined, status: 'missing' };

/** `ValueStatus`'s members, for validating a status read back off an untrusted entry. Keep in sync with the union by construction (`satisfies`). */
const VALUE_STATUSES = [
  'fresh',
  'stale',
  'error',
  'missing',
] as const satisfies readonly ValueStatus[];

function isValueStatus(value: unknown): value is ValueStatus {
  return (
    typeof value === 'string' &&
    (VALUE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * The degraded resolution for a HOST-STORE FAULT: a `store.get`/`vault.get`
 * that threw, an entry whose own property access threw, or a `Proxy` trap
 * that threw partway through the dotted-path walk.
 *
 * It resolves to `'missing'`, not `'error'`: `'error'` means "the producing
 * run failed" (`@markii/runtime`'s `ValueStatus`), and no run failed here —
 * the store itself misbehaved, so "no usable value for this name" is the
 * honest reading, and it is also the resolution `:value[...]` and the
 * data-bound components already degrade to (the `{name}` marker; the quiet
 * empty state). The thrown message rides the existing `error` channel so it
 * still surfaces as a tooltip, and NO `failureKind` is invented — a
 * misbehaving host store is not a member of the script-failure taxonomy.
 */
function hostFault(err: unknown): StorePathResolution {
  return { value: undefined, status: 'missing', error: describeHostFault(err) };
}

/**
 * The one-character prefix that routes a `data=`/`:value[]` name at the
 * vault store instead of the note store (docs/scripting.md, "Vault-published
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
 * A `StoredValue`'s four fields, already read off the (untrusted) entry once
 * and validated into shapes the rest of the pipeline can use without
 * re-touching the entry object. Reading an entry is a one-time operation
 * precisely because every read of it may be a hostile getter or `Proxy`
 * trap: read once, inside a guard, then never look at the original again.
 */
interface SafeEntry {
  value: unknown;
  status: ValueStatus;
  error?: string;
  failureKind?: FailureKind;
}

/**
 * Reads the four `StoredValue` fields off an entry a host store handed back.
 * MAY THROW (every property access here can be a hostile getter or a `Proxy`
 * `get` trap) — every caller wraps it; see `resolveEntryPath`.
 *
 * `status` is validated against the closed `ValueStatus` set and degrades to
 * `'missing'` otherwise, since an off-contract freshness is not a usable
 * one. `error`/`failureKind` are narrowed to `string | undefined`, because
 * both are fed to downstream code (`title=` interpolation, `Object.hasOwn`
 * on the failure-phrase map) that would coerce a non-string and could throw
 * doing so.
 */
function readEntry(entry: StoredValue): SafeEntry {
  const value: unknown = entry.value;
  const status: unknown = entry.status;
  const error: unknown = entry.error;
  const failureKind: unknown = entry.failureKind;
  return {
    value,
    status: isValueStatus(status) ? status : 'missing',
    error: typeof error === 'string' ? error : undefined,
    failureKind:
      typeof failureKind === 'string'
        ? (failureKind as FailureKind)
        : undefined,
  };
}

/** The partial-path degradation: `missing`, but still carrying the root entry's own error/kind (see `walkSegments`). */
function partialMiss(entry: SafeEntry): StorePathResolution {
  return {
    value: undefined,
    status: 'missing',
    error: entry.error,
    failureKind: entry.failureKind,
  };
}

/**
 * Walks `segments[1:]` into `entry.value`, exactly as `resolveStorePath`
 * always has — shared by both entry points so the `Object.hasOwn`
 * prototype-chain guard can never diverge between the note-local and
 * vault-scoped resolvers (a divergence there would be a security bug, not
 * just a bug).
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
 *
 * Never throws. The two rules above touch the STORED VALUE itself, which is
 * whatever a host wrote into the store — a revoked `Proxy`, or one with
 * throwing `getOwnPropertyDescriptor`/`get` traps, makes both
 * `Object.hasOwn(current, segment)` and `current[segment]` throw. Both are
 * guarded, and a throw degrades to `hostFault` (missing + the thrown message
 * in the tooltip channel) rather than escaping into React's render phase.
 * `typeof current !== 'object'` needs no guard: `typeof` is the one operator
 * a `Proxy` cannot intercept.
 */
function walkSegments(
  entry: SafeEntry,
  segments: readonly string[],
): StorePathResolution {
  let current: unknown = entry.value;
  for (let index = 1; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || current === null || typeof current !== 'object') {
      return partialMiss(entry);
    }
    let next: unknown;
    try {
      if (!Object.hasOwn(current, segment)) return partialMiss(entry);
      next = (current as Record<string, unknown>)[segment];
    } catch (err) {
      return hostFault(err);
    }
    current = next;
  }

  return {
    value: current,
    status: entry.status,
    error: entry.error,
    failureKind: entry.failureKind,
  };
}

/**
 * The shared never-throw shell around a store lookup: runs `lookup` (a
 * `store.get`/`vault.get` call, which is HOST CODE and may throw, or may not
 * even be a callable property on a hostile store object), reads the returned
 * entry defensively, then walks the rest of the dotted path. Any throw from
 * any of those steps degrades to `hostFault`.
 *
 * Shared by both resolvers so the note-local and vault-scoped paths cannot
 * drift apart on how much of a hostile host store they tolerate.
 */
function resolveEntryPath(
  lookup: () => StoredValue | undefined,
  segments: readonly string[],
): StorePathResolution {
  let entry: SafeEntry;
  try {
    const raw = lookup();
    // Truthiness is safe on any value, `Proxy` included: it invokes no trap.
    if (!raw) return MISSING;
    entry = readEntry(raw);
  } catch (err) {
    return hostFault(err);
  }
  return walkSegments(entry, segments);
}

/**
 * Resolves a `data=`/`:value[]` name against `store`, walking a dotted path
 * (`repo.stars`) into whatever object/array the root name's stored value
 * turns out to be (docs/scripting.md: `data=<name>` / `:value[<name>]`). A bare
 * name with no dot (`stars`) behaves exactly as a direct `store.get(name)`
 * always has — this is a superset, not a new mode.
 *
 * The root segment itself is resolved via `store.get`, unaffected by the
 * walk rules documented on `walkSegments` (a store name is an opaque
 * string, not itself walked).
 *
 * Never throws — including against a HOSTILE OR BUGGY HOST STORE, which is
 * third-party code at runtime even though it is typed at compile time. An
 * absent store, an absent root name, or any failed segment all degrade to
 * `{ value: undefined, status: 'missing' }`; a `get` that throws, an entry
 * whose property access throws, or a stored value whose `Proxy` traps throw
 * mid-walk degrade the same way, with the thrown message carried in `error`
 * (see `hostFault`). Only a path that resolves *in full* reports the root
 * entry's own status (`fresh`/`stale`/`error`/`missing`); a partial failure
 * partway through the path is always reported as `missing`, never as
 * whatever the root's own status happened to be.
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

  return resolveEntryPath(() => store?.get(root), segments);
}

/**
 * Resolves a `data=`/`:value[]` name against a `ValueScope`, routing an
 * `@`-prefixed name (`@gh.stars`) at `scope.vault` instead of `scope.store`
 * (docs/scripting.md: "bare name = mine, `@name` = the vault's"). Exactly one
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
 * Never throws — a throwing `VaultStore` degrades exactly like a throwing
 * `ValueStore`, since both scopes share `resolveEntryPath`.
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

    return resolveEntryPath(() => scope.vault?.get(root), segments);
  }

  return resolveStorePath(scope.store, dottedName);
}
