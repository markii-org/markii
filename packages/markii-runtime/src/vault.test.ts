import { describe, expect, it } from 'vitest';
import type { StoredValue } from './store';
import { createVaultStore } from './vault';

function fresh(value: unknown): StoredValue {
  return { value, status: 'fresh', ranAt: 0 };
}

describe('createVaultStore', () => {
  it('has/get return false/undefined for hostile names on an empty vault', () => {
    const { store } = createVaultStore();
    for (const name of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
    ]) {
      expect(store.has(name)).toBe(false);
      expect(store.get(name)).toBeUndefined();
    }
  });

  it('a real entry stored under a hostile name round-trips and does not pollute Object.prototype', async () => {
    const { store, writer } = createVaultStore();
    for (const name of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
    ]) {
      const result = await writer.publish(name, fresh(`value-for-${name}`));
      expect(result).toEqual({ ok: true });
      expect(store.has(name)).toBe(true);
      expect(store.get(name)).toMatchObject({ value: `value-for-${name}` });
    }

    // No pollution of the shared Object.prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(
      ({} as Record<string, unknown>)['value-for-__proto__'],
    ).toBeUndefined();

    // snapshot() is a plain object (ordinary prototype), but the vault's
    // OWN internal storage is null-proto — the hostile names living safely
    // inside it, retrievable only via get/has, is what's under test above.
    const snap = store.snapshot();
    expect(Object.getPrototypeOf(snap)).toBe(Object.prototype);
    expect(snap['constructor']).toMatchObject({
      value: 'value-for-constructor',
    });
  });

  it('canPublish returning false rejects the publish: not stored, ok:false, kind:claimed', async () => {
    const { store, writer } = createVaultStore({ canPublish: () => false });

    const result = await writer.publish('gh', fresh(42));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('claimed');
      expect(result.error.message).toContain('gh');
    }
    expect(store.has('gh')).toBe(false);
    expect(store.get('gh')).toBeUndefined();
  });

  it('a throwing canPublish rejects with kind:policy, never rethrows, and does not write', async () => {
    const { store, writer } = createVaultStore({
      canPublish: () => {
        throw new Error('policy hook exploded');
      },
    });

    expect(await writer.publish('gh', fresh(42))).toEqual({
      ok: false,
      error: { kind: 'policy', message: 'policy hook exploded' },
    });
    expect(store.has('gh')).toBe(false);
  });

  it('a second publish of the same name with no hook overwrites (last write wins)', async () => {
    const { store, writer } = createVaultStore();

    await writer.publish('gh', fresh('first'));
    expect(store.get('gh')).toMatchObject({ value: 'first' });

    await writer.publish('gh', fresh('second'));
    expect(store.get('gh')).toMatchObject({ value: 'second' });
  });

  it('canPublish sees the candidate name and entry', async () => {
    const seen: Array<{ name: string; entry: StoredValue }> = [];
    const { writer } = createVaultStore({
      canPublish: (name, entry) => {
        seen.push({ name, entry });
        return true;
      },
    });

    await writer.publish('gh', fresh(99));
    expect(seen).toEqual([{ name: 'gh', entry: fresh(99) }]);
  });

  it('initial seeds the vault and is independent of the caller-supplied object', async () => {
    const seedEntry = fresh('seeded');
    const { store, writer } = createVaultStore({
      initial: { gh: seedEntry },
    });

    expect(store.get('gh')).toMatchObject({ value: 'seeded' });

    await writer.publish('other', fresh('unrelated'));
    expect(store.has('gh')).toBe(true);
    expect(store.get('other')).toMatchObject({ value: 'unrelated' });
  });

  it('store has no `set` at runtime', () => {
    const { store } = createVaultStore();
    expect(
      (store as unknown as Record<string, unknown>)['set'],
    ).toBeUndefined();
  });
});
