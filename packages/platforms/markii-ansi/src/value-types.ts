/**
 * `@markii/ansi`'s own structural view of `@markii/runtime`'s value-store
 * contract. This package's dependency list is deliberately minimal (exactly
 * `@markii/core` and `@markii/stdlib`; see AGENTS.md and the batch brief),
 * so it never imports `@markii/runtime` at runtime: declaring the shapes it
 * needs here, rather than importing them, keeps a terminal render usable in
 * a context that never pulled in the runtime package at all (a CLI that
 * hands this engine values it read out of a bundle's cache directly, say).
 *
 * A real `@markii/runtime` `ValueStore`/`VaultStore` satisfies these
 * interfaces structurally (TypeScript's structural typing needs no explicit
 * relationship declared), so a host that already has one passes it straight
 * in with no adapter. `value-types.drift.test.ts` is what keeps this copy
 * honest: it imports the real runtime types as a devDependency, test-only,
 * and fails if the two shapes ever diverge.
 */

/** Freshness of one stored value. Mirrors `@markii/runtime`'s `ValueStatus` exactly. */
export type ValueStatus = 'fresh' | 'stale' | 'error' | 'missing';

/** The closed script-failure taxonomy. Mirrors `@markii/runtime`'s `FailureKind` exactly. */
export type FailureKind =
  'script-error' | 'capability-denied' | 'tier-blocked' | 'limit';

/** One named value plus its freshness bookkeeping. Mirrors `@markii/runtime`'s `StoredValue`'s readable fields. */
export interface StoredValue {
  value: unknown;
  status: ValueStatus;
  error?: string;
  failureKind?: FailureKind;
}

/** The read-only view this engine needs of a note's value store. A real `ValueStore` satisfies this structurally. */
export interface AnsiValueStore {
  get(name: string): StoredValue | undefined;
  has(name: string): boolean;
}

/** The read-only view this engine needs of the vault (cross-note) store. A real `VaultStore` satisfies this structurally. */
export interface AnsiVaultStore {
  get(name: string): StoredValue | undefined;
  has(name: string): boolean;
}
