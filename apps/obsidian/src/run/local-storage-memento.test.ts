import { describe, expect, it } from 'vitest';
import { createLocalStorageMemento } from './local-storage-memento.js';

function fakeLocalStorage(): {
  load: (key: string) => unknown;
  save: (key: string, value: unknown) => void;
  calls: Array<{ key: string; value: unknown }>;
} {
  const store = new Map<string, unknown>();
  const calls: Array<{ key: string; value: unknown }> = [];
  return {
    load: (key) => (store.has(key) ? store.get(key) : null),
    save: (key, value) => {
      calls.push({ key, value });
      if (value === null) store.delete(key);
      else store.set(key, value);
    },
    calls,
  };
}

describe('createLocalStorageMemento', () => {
  it('get returns the default when nothing is stored', () => {
    const { load, save } = fakeLocalStorage();
    const memento = createLocalStorageMemento(load, save);
    expect(memento.get('missing')).toBeUndefined();
    expect(memento.get('missing', 'fallback')).toBe('fallback');
  });

  it('update then get round-trips a value through the backing store', async () => {
    const { load, save } = fakeLocalStorage();
    const memento = createLocalStorageMemento(load, save);
    await memento.update('markii.netGrants', { a: 1 });
    expect(memento.get('markii.netGrants')).toEqual({ a: 1 });
  });

  it('updating with undefined clears the entry via a null save call', async () => {
    const { load, save, calls } = fakeLocalStorage();
    const memento = createLocalStorageMemento(load, save);
    await memento.update('k', { a: 1 });
    await memento.update('k', undefined);
    expect(memento.get('k')).toBeUndefined();
    expect(calls[calls.length - 1]).toEqual({ key: 'k', value: null });
  });

  it('every write goes through the injected save function, never a global', async () => {
    const { load, save, calls } = fakeLocalStorage();
    const memento = createLocalStorageMemento(load, save);
    await memento.update('markii.runValues:note.mk.md', {
      x: { status: 'fresh' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.key).toBe('markii.runValues:note.mk.md');
  });
});

describe('createLocalStorageMemento — a full device store must not break a run', () => {
  it('reports a refused write instead of throwing', async () => {
    // localStorage is finite and genuinely fills up: @markii/host caps a
    // document's cache and values at 1MB each against a ~5MB origin quota,
    // so a few dashboard notes reach it. Persistence is a convenience and
    // must never cost the user the run they asked for.
    const failures: Array<{ key: string; error: unknown }> = [];
    const quotaError = new Error('QuotaExceededError');
    const memento = createLocalStorageMemento(
      () => undefined,
      () => {
        throw quotaError;
      },
      (key, error) => failures.push({ key, error }),
    );

    await expect(
      memento.update('markii.values.note', { a: 1 }),
    ).resolves.toBeUndefined();
    expect(failures).toEqual([
      { key: 'markii.values.note', error: quotaError },
    ]);
  });

  it('does not throw when no failure reporter was supplied', async () => {
    const memento = createLocalStorageMemento(
      () => undefined,
      () => {
        throw new Error('QuotaExceededError');
      },
    );
    await expect(memento.update('k', 1)).resolves.toBeUndefined();
  });

  it('degrades to the default when a read throws', () => {
    const memento = createLocalStorageMemento(
      () => {
        throw new Error('unreadable');
      },
      () => undefined,
    );
    expect(memento.get('k', 'fallback')).toBe('fallback');
  });
});
