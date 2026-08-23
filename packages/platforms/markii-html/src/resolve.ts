import type {
  FailureKind,
  StoredValue,
  ValueStatus,
  ValueStore,
  VaultStore,
} from '@markii/runtime';

/**
 * The string engine's port of `@markii/react`'s `store-path.ts`: resolves a
 * `data=`/`:value[]` name (optionally dotted, optionally `@`-prefixed for the
 * vault) against a `ValueStore`/`VaultStore`. Ported rather than imported
 * because `store-path.ts` is not part of `@markii/react`'s public export
 * surface, and the two platform renderers are deliberately independent
 * implementations of the same contract (docs/scripting.md), not a shared
 * runtime dependency on each other. The resolution semantics — dotted-path
 * walk, `@`-scoping, never-throw-on-a-hostile-store — are kept identical to
 * the React port; only the presentation layer built on top differs by engine.
 */

/** What resolving a (possibly dotted) name against a `ValueStore`/`VaultStore` produces. */
export interface StorePathResolution {
  value: unknown;
  status: ValueStatus;
  /** The root entry's error message, if it has one — carried through regardless of how the rest of the path resolved. Always a `string` when present. */
  error?: string;
  /** The root entry's `failureKind`, carried through exactly like `error`. Absent when the root entry didn't carry one, or on a host-store fault (never invented). */
  failureKind?: FailureKind;
}

const MISSING: StorePathResolution = { value: undefined, status: 'missing' };

/** `ValueStatus`'s members, for validating a status read back off an untrusted entry. */
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
 * The message a host-data fault falls back to when even describing the
 * thrown value throws. Deliberately generic: it only ever reaches a tooltip.
 */
const HOST_FAULT_MESSAGE = 'value store threw while reading this name';

/**
 * Best-effort description of something host code threw, for the tooltip
 * channel. Every step is itself guarded: `instanceof`, `.message`, and
 * `String(...)` can all throw when the thrown value is a revoked `Proxy` or
 * an object with hostile traps/getters.
 */
export function describeHostFault(err: unknown): string {
  try {
    if (err instanceof Error) {
      const { message } = err;
      if (typeof message === 'string' && message !== '') return message;
    }
    const text = String(err);
    return text === '' ? HOST_FAULT_MESSAGE : text;
  } catch {
    return HOST_FAULT_MESSAGE;
  }
}

/** The degraded resolution for a HOST-STORE FAULT: resolves to `'missing'`, carrying the thrown message as `error`, never inventing a `failureKind`. */
function hostFault(err: unknown): StorePathResolution {
  return { value: undefined, status: 'missing', error: describeHostFault(err) };
}

/** The one-character prefix that routes a `data=`/`:value[]` name at the vault store instead of the note store (docs/scripting.md). */
export const VAULT_NAME_PREFIX = '@';

/** Where a `resolveScopedPath` lookup may read from. Either half may be absent. */
export interface ValueScope {
  store?: ValueStore;
  vault?: VaultStore;
}

/** A `StoredValue`'s four fields, read once off an untrusted entry and validated. */
interface SafeEntry {
  value: unknown;
  status: ValueStatus;
  error?: string;
  failureKind?: FailureKind;
}

/** Reads the four `StoredValue` fields off an entry a host store handed back. MAY THROW; every caller wraps it. */
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

/** The partial-path degradation: `missing`, but still carrying the root entry's own error/kind. */
function partialMiss(entry: SafeEntry): StorePathResolution {
  return {
    value: undefined,
    status: 'missing',
    error: entry.error,
    failureKind: entry.failureKind,
  };
}

/**
 * Walks `segments[1:]` into `entry.value`. Never throws: a hostile stored
 * value (a revoked `Proxy`, throwing traps) degrades to `hostFault` rather
 * than escaping. `Object.hasOwn` is the load-bearing guard against a segment
 * like `__proto__`/`constructor` resolving through the prototype chain.
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

/** The shared never-throw shell around a store lookup. */
function resolveEntryPath(
  lookup: () => StoredValue | undefined,
  segments: readonly string[],
): StorePathResolution {
  let entry: SafeEntry;
  try {
    const raw = lookup();
    if (!raw) return MISSING;
    entry = readEntry(raw);
  } catch (err) {
    return hostFault(err);
  }
  return walkSegments(entry, segments);
}

/**
 * Resolves a `data=`/`:value[]` name against `store`, walking a dotted path.
 * Never throws, including against a hostile or buggy host store.
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
 * `@`-prefixed name at `scope.vault` instead of `scope.store` ("bare name =
 * mine, `@name` = the vault's"). Never throws.
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

/** What `safeRead` produces: the extracted fields, plus the thrown message when the extraction had to be abandoned. */
export interface SafeRead<T> {
  fields: T;
  fault?: string;
}

/**
 * Runs `read` — an extraction that touches an untrusted bound `data` value —
 * and falls back to `fallback()` if any part of it throws. Ported from
 * `@markii/react`'s `safe-data.ts`: wraps the WHOLE extraction, not each
 * individual property read, so a value whose reads throw degrades to the
 * same "nothing resolved" state a genuinely missing binding already renders.
 */
export function safeRead<T>(read: () => T, fallback: () => T): SafeRead<T> {
  try {
    return { fields: read() };
  } catch (err) {
    return { fields: fallback(), fault: describeHostFault(err) };
  }
}
