import type { StoredValue } from './store.js';

/**
 * Slice 3 of the scripting-usability layer (docs/scripting.md, "Vault-published
 * values (the bulletin board)"): the APP-SCOPED store that a `publish`-
 * flagged script block's result lands in, as distinct from `store.ts`'s
 * NOTE-scoped `ValueStore`. "The store is app-side (§9): publishing adds no
 * files to the vault" — this module holds no persistence of its own either;
 * it is purely an in-memory reference implementation a host may use as-is or
 * replace with its own (e.g. one backed by disk or a database).
 *
 * The read/write split mirrors `store.ts`'s null-proto, `Object.hasOwn`-
 * guarded defensive posture (protection against `name`s like `__proto__` or
 * `constructor` resolving to an inherited `Object.prototype` member instead
 * of a real, or correctly-absent, entry), but goes one step further:
 * `VaultStore` (read) and `VaultWriter` (write) are separate interfaces
 * backed by the same data, so a host can hand a renderer the read seam alone
 * and withhold the write capability entirely. §8: "Reading is render-time
 * and pure ... Publishing requires a grant ... because it writes beyond the
 * note" — possessing a `VaultWriter` reference IS that grant. There is no
 * ambient "is this note allowed to publish" check anywhere in this module;
 * the capability itself is the permission.
 */

/**
 * Read-only view of the vault-level, app-managed store (§8). Deliberately
 * has NO `set` — rendering reads the vault and must never be able to write
 * it; only a `VaultWriter` (obtained separately, and only by something the
 * host trusts with the publish grant) can do that.
 */
export interface VaultStore {
  get(name: string): StoredValue | undefined;
  has(name: string): boolean;
  snapshot(): Record<string, StoredValue>;
}

/**
 * A publish rejection. `kind` is a plain `string` (not a fixed union),
 * mirroring `ExecuteFailure.error.kind` in `run.ts` — callers are expected
 * to branch on `ok`, never on `message` text. This module's own writer only
 * ever produces `'claimed'` (see `createVaultStore`'s `canPublish`) or
 * `'policy'` (a throwing `canPublish` hook); a host's own `VaultWriter`
 * implementation is free to define further `kind`s for its own policies.
 */
export interface VaultPublishFailure {
  ok: false;
  error: { kind: string; message: string };
}

export interface VaultPublishSuccess {
  ok: true;
}

export type VaultPublishResult = VaultPublishSuccess | VaultPublishFailure;

/**
 * The capability-style write side: possessing a `VaultWriter` IS the host's
 * publish grant (§8: "Publishing requires a grant ... because it writes
 * beyond the note"). Hosts may implement this themselves — e.g. one that
 * closes over the publishing note's identity and a persistent claim table —
 * rather than using `createVaultStore`'s reference implementation.
 * `publish` may be async so a host-backed implementation (network call,
 * disk write, claim negotiation) fits the same shape as the in-memory one.
 */
export interface VaultWriter {
  publish(
    name: string,
    entry: StoredValue,
  ): VaultPublishResult | Promise<VaultPublishResult>;
}

export interface CreateVaultStoreOptions {
  /** Seeds the vault, e.g. from a previous session's persisted snapshot. */
  initial?: Record<string, StoredValue>;
  /**
   * Single-writer-per-name hook — APP POLICY, not runtime policy (§8: "The
   * app rejects a second note publishing an already-claimed name"). Given
   * the candidate `name` and `entry`, return `false` to reject the claim.
   * Absent => every publish is accepted (no claim tracking at all). A hook
   * that throws is treated as a rejection (`kind: 'policy'`), never
   * propagated — a buggy policy hook must fail closed, not crash the run.
   */
  canPublish?: (name: string, entry: StoredValue) => boolean;
}

/**
 * Reference in-memory `VaultStore`/`VaultWriter` pair. `store` and `writer`
 * are deliberately SEPARATE objects backed by the same data, so a host can
 * hand `store` to a renderer while withholding `writer` from anything that
 * shouldn't be able to publish. No persistence of its own: storage is the
 * host's concern (§9, "publishing adds no files to the vault") — a host
 * that needs persistence wraps or replaces this with its own `VaultWriter`.
 */
export interface VaultStoreHandle {
  store: VaultStore;
  writer: VaultWriter;
}

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Creates an in-memory `VaultStoreHandle`. Backed by a null-prototype
 * object, exactly like `createValueStore` — a vault `name` colliding with an
 * inherited `Object.prototype` member (`__proto__`, `constructor`,
 * `toString`, `hasOwnProperty`, ...) can never resolve to that inherited
 * member instead of a real (or correctly-absent) entry.
 */
export function createVaultStore(
  options: CreateVaultStoreOptions = {},
): VaultStoreHandle {
  const { initial = {}, canPublish } = options;

  const values: Record<string, StoredValue> = Object.create(null) as Record<
    string,
    StoredValue
  >;
  for (const [name, entry] of Object.entries(initial)) {
    values[name] = entry;
  }

  const store: VaultStore = {
    get(name: string): StoredValue | undefined {
      return Object.hasOwn(values, name) ? values[name] : undefined;
    },
    has(name: string): boolean {
      return Object.hasOwn(values, name);
    },
    // Shallow copy, exactly like `ValueStore.snapshot`: this is a fresh
    // plain object, but each `StoredValue` it holds is the same object
    // reference already in the vault — mutating a returned entry in place
    // would be visible to the vault too. The returned object's own
    // prototype is the ordinary `Object.prototype` (a plain `{ ...values }`
    // spread, not `Object.create(null)`), since it's a caller-facing value
    // with no further hostile-key lookups performed against it here.
    snapshot(): Record<string, StoredValue> {
      return { ...values };
    },
  };

  const writer: VaultWriter = {
    publish(name: string, entry: StoredValue): VaultPublishResult {
      if (canPublish) {
        let allowed: boolean;
        try {
          allowed = canPublish(name, entry);
        } catch (err) {
          return {
            ok: false,
            error: { kind: 'policy', message: describeThrown(err) },
          };
        }
        if (!allowed) {
          return {
            ok: false,
            error: {
              kind: 'claimed',
              message: `vault name "${name}" is already claimed by another writer`,
            },
          };
        }
      }

      values[name] = entry;
      return { ok: true };
    },
  };

  return { store, writer };
}
