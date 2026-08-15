import { describe, expect, it } from 'vitest';
import { createValueStore } from './store';
import type { StoredValue } from './store';

const FRESH: StoredValue = { value: 42, status: 'fresh', ranAt: 1000 };

describe('createValueStore', () => {
  it('has nothing and returns undefined for an unknown name on a fresh store', () => {
    const store = createValueStore();
    expect(store.has('stars')).toBe(false);
    expect(store.get('stars')).toBeUndefined();
  });

  it('returns a set entry via get/has', () => {
    const store = createValueStore();
    store.set('stars', FRESH);
    expect(store.has('stars')).toBe(true);
    expect(store.get('stars')).toEqual(FRESH);
  });

  it('overwrites an existing entry on a second set', () => {
    const store = createValueStore();
    store.set('stars', FRESH);
    const stale: StoredValue = { value: 41, status: 'stale', ranAt: 500 };
    store.set('stars', stale);
    expect(store.get('stars')).toEqual(stale);
  });

  it('seeds entries from the optional `initial` argument', () => {
    const store = createValueStore({ stars: FRESH });
    expect(store.has('stars')).toBe(true);
    expect(store.get('stars')).toEqual(FRESH);
  });

  it('snapshot returns every stored entry, keyed by name', () => {
    const store = createValueStore();
    store.set('stars', FRESH);
    store.set('forks', { value: 7, status: 'error', error: 'boom' });
    expect(store.snapshot()).toEqual({
      stars: FRESH,
      forks: { value: 7, status: 'error', error: 'boom' },
    });
  });

  it('snapshot is a shallow copy: mutating the store after snapshotting does not change the earlier snapshot', () => {
    const store = createValueStore();
    store.set('stars', FRESH);
    const snap = store.snapshot();
    store.set('stars', { value: 99, status: 'fresh' });
    expect(snap.stars).toEqual(FRESH);
  });

  it('does not resolve `__proto__` to an inherited Object.prototype member', () => {
    const store = createValueStore();
    expect(store.get('__proto__')).toBeUndefined();
    expect(store.has('__proto__')).toBe(false);
  });

  it('does not resolve `constructor` to an inherited Object.prototype member', () => {
    const store = createValueStore();
    expect(store.get('constructor')).toBeUndefined();
    expect(store.has('constructor')).toBe(false);
  });

  it('does not resolve `toString`/`hasOwnProperty`/`valueOf` to inherited members', () => {
    const store = createValueStore();
    expect(store.get('toString')).toBeUndefined();
    expect(store.get('hasOwnProperty')).toBeUndefined();
    expect(store.get('valueOf')).toBeUndefined();
    expect(store.has('toString')).toBe(false);
  });

  it('setting and getting a prototype-colliding name works like any other name', () => {
    const store = createValueStore();
    store.set('constructor', FRESH);
    expect(store.has('constructor')).toBe(true);
    expect(store.get('constructor')).toEqual(FRESH);
    // Unrelated names are unaffected — confirms `set` on a colliding key
    // didn't corrupt the store's own prototype chain.
    expect(store.get('stars')).toBeUndefined();
  });
});
