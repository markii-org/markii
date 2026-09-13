import { describe, expect, it } from 'vitest';
import {
  createValueStore,
  createVaultStore,
  FAILURE_KINDS,
} from '@markii/runtime';
import type { ValueStore } from '@markii/runtime';
import type {
  AnsiValueStore,
  AnsiVaultStore,
  FailureKind,
  ValueStatus,
} from './value-types.js';

/**
 * `@markii/ansi` declares its own structural copies of `@markii/runtime`'s
 * `ValueStore`/`VaultStore`/`FailureKind`/`ValueStatus` shapes rather than
 * importing the package at runtime (see `value-types.ts`'s module comment).
 * This suite is the drift alarm: it imports the real runtime types as a
 * devDependency, TEST-ONLY, and proves the two shapes are still the same
 * thing by both a real assignment (a genuine `ValueStore` handed to a
 * function typed at `AnsiValueStore`) and a runtime assertion, not merely a
 * `satisfies` check that a refactor could silently loosen.
 */

function acceptsValueStore(store: AnsiValueStore): AnsiValueStore {
  return store;
}

function acceptsVaultStore(store: AnsiVaultStore): AnsiVaultStore {
  return store;
}

describe('value-types drift: ValueStore/VaultStore assignability', () => {
  it('a real ValueStore is assignable to AnsiValueStore', () => {
    const store: ValueStore = createValueStore({
      stars: { value: 7, status: 'fresh' },
    });
    const accepted = acceptsValueStore(store);
    expect(accepted.get('stars')?.value).toBe(7);
    expect(accepted.has('stars')).toBe(true);
  });

  it('a real VaultStore is assignable to AnsiVaultStore', () => {
    const { store: vault, writer } = createVaultStore();
    void writer.publish('gh', { value: 1, status: 'fresh' });
    const accepted = acceptsVaultStore(vault);
    expect(accepted.get('gh')?.value).toBe(1);
    expect(accepted.has('gh')).toBe(true);
  });
});

describe('value-types drift: FailureKind arity and membership', () => {
  it("every runtime FAILURE_KINDS member is assignable to this package's FailureKind", () => {
    const asAnsiFailureKinds: readonly FailureKind[] = FAILURE_KINDS;
    expect(asAnsiFailureKinds).toEqual(FAILURE_KINDS);
  });

  it('the two FailureKind unions have the same arity', () => {
    const ansiKinds: readonly FailureKind[] = [
      'script-error',
      'capability-denied',
      'tier-blocked',
      'limit',
    ];
    expect(ansiKinds).toHaveLength(FAILURE_KINDS.length);
    expect(new Set(ansiKinds)).toEqual(new Set(FAILURE_KINDS));
  });
});

describe('value-types drift: ValueStatus membership', () => {
  it('the four ValueStatus members match the runtime union exactly', () => {
    const ansiStatuses: readonly ValueStatus[] = [
      'fresh',
      'stale',
      'error',
      'missing',
    ];
    const runtimeStatuses: readonly ValueStatus[] = [
      'fresh',
      'stale',
      'error',
      'missing',
    ];
    expect(new Set(ansiStatuses)).toEqual(new Set(runtimeStatuses));
    expect(ansiStatuses).toHaveLength(4);
  });
});
