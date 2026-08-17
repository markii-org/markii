/**
 * Slice 1's pure read path (DESIGN.md §8): the note-scoped value store that
 * rendering reads from. Nothing here executes a script, fetches anything,
 * or knows Lua exists — this module only holds whatever a future runner
 * (Slice 2) or a bundle-cache hydration step has already written, keyed by
 * the script's declared `name`. "Rendering is pure; running is an event" —
 * this store is the pure side of that split.
 */

import type { FailureKind } from './failure.js';

/**
 * Freshness of one stored value:
 * - `fresh`   — produced by the most recent successful run.
 * - `stale`   — produced by an earlier run; still shown, marked stale.
 * - `error`   — the producing run failed; no usable value.
 * - `missing` — no run has ever produced this name.
 */
export type ValueStatus = 'fresh' | 'stale' | 'error' | 'missing';

/** One named value plus its freshness bookkeeping. */
export interface StoredValue {
  value: unknown;
  status: ValueStatus;
  error?: string;
  /**
   * Set alongside `error` on every `status: 'error'` outcome (see
   * `./run.ts`'s `runDocumentScripts`) — the closed `FailureKind` (`./
   * failure.ts`) the failure was classified as, already run through
   * `normalizeFailureKind` at the run-path boundary so it is safe for a
   * renderer to branch on directly. Absent for a non-error status, and
   * absent for an error `StoredValue` written by something other than the
   * run path (e.g. a hand-constructed fixture) — a renderer must still
   * degrade gracefully when this is missing.
   */
  failureKind?: FailureKind;
  ranAt?: number;
}

/**
 * Read/write access to the note-scoped value store. Script blocks "may
 * appear anywhere markdown may... but `name`s land in one note-scoped value
 * store regardless of position" (DESIGN.md §8) — this interface is that
 * store. Rendering only ever calls `get`/`has`/`snapshot`; `set` exists for
 * whatever publishes values into the store (a script runner, a bundle
 * cache-loader) — entirely out of scope for Slice 1.
 */
export interface ValueStore {
  get(name: string): StoredValue | undefined;
  has(name: string): boolean;
  set(name: string, entry: StoredValue): void;
  snapshot(): Record<string, StoredValue>;
}

/**
 * Simple in-memory `ValueStore`. Backed by a null-prototype object so a
 * script `name` that collides with an inherited `Object.prototype` member
 * (`constructor`, `toString`, `hasOwnProperty`, `valueOf`, `__proto__`, ...)
 * can never resolve to that inherited member instead of a real (or
 * correctly-absent) entry — the same class of defense `@markii/react`
 * already applies to its directive registry (`createRegistry`) and hast-tag
 * lookup (`URL_ATTRIBUTE_BY_TAG`).
 */
export function createValueStore(
  initial: Record<string, StoredValue> = {},
): ValueStore {
  const values: Record<string, StoredValue> = Object.create(null) as Record<
    string,
    StoredValue
  >;
  for (const [name, entry] of Object.entries(initial)) {
    values[name] = entry;
  }

  return {
    get(name: string): StoredValue | undefined {
      return Object.hasOwn(values, name) ? values[name] : undefined;
    },
    has(name: string): boolean {
      return Object.hasOwn(values, name);
    },
    set(name: string, entry: StoredValue): void {
      values[name] = entry;
    },
    // Shallow copy: this is a new plain object, but each `StoredValue` it
    // holds is the same object reference already in the store — mutating a
    // returned entry in place would be visible to the store too.
    snapshot(): Record<string, StoredValue> {
      return { ...values };
    },
  };
}
