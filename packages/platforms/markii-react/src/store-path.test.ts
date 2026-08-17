import { describe, expect, it } from 'vitest';
import { createValueStore, createVaultStore } from '@markii/runtime';
import type { StoredValue } from '@markii/runtime';
import { resolveScopedPath, resolveStorePath } from './store-path';

describe('resolveStorePath', () => {
  it('resolves a nested field of a stored object', () => {
    const store = createValueStore({
      repo: {
        value: { stars: 42, forks: 7, spark: [3, 5, 4] },
        status: 'fresh',
      },
    });
    expect(resolveStorePath(store, 'repo.stars')).toEqual({
      value: 42,
      status: 'fresh',
      error: undefined,
    });
    expect(resolveStorePath(store, 'repo.forks')).toEqual({
      value: 7,
      status: 'fresh',
      error: undefined,
    });
  });

  it('resolves a nested array field of a stored object', () => {
    const store = createValueStore({
      repo: {
        value: { stars: 42, spark: [3, 5, 4, 8] },
        status: 'fresh',
      },
    });
    expect(resolveStorePath(store, 'repo.spark')).toEqual({
      value: [3, 5, 4, 8],
      status: 'fresh',
      error: undefined,
    });
  });

  it('indexes into a nested array by numeric string segment', () => {
    const store = createValueStore({
      repo: { value: { spark: [3, 5, 4, 8] }, status: 'fresh' },
    });
    expect(resolveStorePath(store, 'repo.spark.0')).toEqual({
      value: 3,
      status: 'fresh',
      error: undefined,
    });
    expect(resolveStorePath(store, 'repo.spark.2')).toEqual({
      value: 4,
      status: 'fresh',
      error: undefined,
    });
  });

  it('returns missing for an unknown root name', () => {
    const store = createValueStore();
    expect(resolveStorePath(store, 'repo.stars')).toEqual({
      value: undefined,
      status: 'missing',
    });
  });

  it('returns missing for an unknown segment on a known root', () => {
    const store = createValueStore({
      repo: { value: { stars: 42 }, status: 'fresh' },
    });
    expect(resolveStorePath(store, 'repo.nope')).toEqual({
      value: undefined,
      status: 'missing',
      error: undefined,
    });
  });

  it('never resolves __proto__ and never pollutes the prototype', () => {
    const store = createValueStore({
      repo: { value: { stars: 42 }, status: 'fresh' },
    });
    const result = resolveStorePath(store, 'repo.__proto__');
    expect(result.status).toBe('missing');
    expect(result.value).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('never resolves constructor', () => {
    const store = createValueStore({
      repo: { value: { stars: 42 }, status: 'fresh' },
    });
    const result = resolveStorePath(store, 'repo.constructor');
    expect(result.status).toBe('missing');
    expect(result.value).toBeUndefined();
  });

  it('treats an empty segment (a..b) as unresolved', () => {
    const store = createValueStore({
      repo: { value: { stars: { count: 42 } }, status: 'fresh' },
    });
    expect(resolveStorePath(store, 'repo..stars').status).toBe('missing');
  });

  it('treats a trailing dot as unresolved', () => {
    const store = createValueStore({
      repo: { value: { stars: 42 }, status: 'fresh' },
    });
    expect(resolveStorePath(store, 'repo.').status).toBe('missing');
  });

  it('treats a leading dot as unresolved (empty root name)', () => {
    const store = createValueStore({
      repo: { value: { stars: 42 }, status: 'fresh' },
    });
    expect(resolveStorePath(store, '.repo').status).toBe('missing');
  });

  it('is backward-compatible with a bare (undotted) name', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh' },
    });
    expect(resolveStorePath(store, 'stars')).toEqual({
      value: 42,
      status: 'fresh',
      error: undefined,
    });
  });

  it('reports the root status even for a bare name whose status is missing/error', () => {
    const store = createValueStore({
      stars: { value: null, status: 'error', error: 'fetch failed' },
    });
    expect(resolveStorePath(store, 'stars')).toEqual({
      value: null,
      status: 'error',
      error: 'fetch failed',
    });
  });

  it('degrades to missing with no store at all', () => {
    expect(resolveStorePath(undefined, 'repo.stars')).toEqual({
      value: undefined,
      status: 'missing',
    });
  });

  it('does not descend into a non-object value', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh' },
    });
    expect(resolveStorePath(store, 'stars.value').status).toBe('missing');
  });
});

describe('resolveScopedPath', () => {
  it('resolves an @-prefixed name from the vault', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: { stars: 42 }, status: 'fresh' } },
    });
    expect(resolveScopedPath({ vault }, '@gh.stars')).toEqual({
      value: 42,
      status: 'fresh',
      error: undefined,
    });
  });

  it('resolves a bare name from the note store', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh' },
    });
    expect(resolveScopedPath({ store }, 'stars')).toEqual({
      value: 42,
      status: 'fresh',
      error: undefined,
    });
  });

  it('does not let a note-local name satisfy an @-prefixed lookup', () => {
    const store = createValueStore({
      gh: { value: { stars: 42 }, status: 'fresh' },
    });
    const { store: vault } = createVaultStore();
    expect(resolveScopedPath({ store, vault }, '@gh.stars')).toEqual({
      value: undefined,
      status: 'missing',
    });
  });

  it('does not let a vault name satisfy a bare lookup', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: { stars: 42 }, status: 'fresh' } },
    });
    const store = createValueStore();
    expect(resolveScopedPath({ store, vault }, 'gh.stars')).toEqual({
      value: undefined,
      status: 'missing',
    });
  });

  it('never resolves @__proto__, @constructor, @toString, @hasOwnProperty on an empty vault', () => {
    const { store: vault } = createVaultStore();
    for (const name of [
      '@__proto__',
      '@constructor',
      '@toString',
      '@hasOwnProperty',
    ]) {
      expect(resolveScopedPath({ vault }, name).status).toBe('missing');
    }
  });

  it('resolves values genuinely stored under __proto__/constructor/toString/hasOwnProperty names', () => {
    // `__proto__` must be a computed key here — a literal `__proto__: x` in
    // an object literal sets the prototype instead of creating an own
    // enumerable property, which would silently defeat this test. Each
    // entry is annotated as `StoredValue` explicitly (rather than relying
    // on contextual typing from the enclosing object) because TypeScript
    // resolves `constructor`/`toString`/`hasOwnProperty` object-literal
    // properties against `Object.prototype`'s own member types instead of
    // an index signature's value type, which would otherwise widen
    // `status: 'fresh'` to plain `string`.
    const fresh = (value: unknown): StoredValue => ({ value, status: 'fresh' });
    const initial: Record<string, StoredValue> = {
      ['__proto__']: fresh(1),
      constructor: fresh(2),
      toString: fresh(3),
      hasOwnProperty: fresh(4),
    };
    const { store: vault } = createVaultStore({ initial });
    expect(resolveScopedPath({ vault }, '@__proto__')).toEqual({
      value: 1,
      status: 'fresh',
      error: undefined,
    });
    expect(resolveScopedPath({ vault }, '@constructor')).toEqual({
      value: 2,
      status: 'fresh',
      error: undefined,
    });
    expect(resolveScopedPath({ vault }, '@toString')).toEqual({
      value: 3,
      status: 'fresh',
      error: undefined,
    });
    expect(resolveScopedPath({ vault }, '@hasOwnProperty')).toEqual({
      value: 4,
      status: 'fresh',
      error: undefined,
    });
  });

  it('never resolves @gh.constructor / @gh.__proto__ / @gh.hasOwnProperty (prototype-chain guard)', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: { stars: 42 }, status: 'fresh' } },
    });
    expect(resolveScopedPath({ vault }, '@gh.constructor').status).toBe(
      'missing',
    );
    expect(resolveScopedPath({ vault }, '@gh.__proto__').status).toBe(
      'missing',
    );
    expect(resolveScopedPath({ vault }, '@gh.hasOwnProperty').status).toBe(
      'missing',
    );
  });

  it('treats @gh..stars (empty segment) as unresolved', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: { stars: 42 }, status: 'fresh' } },
    });
    expect(resolveScopedPath({ vault }, '@gh..stars').status).toBe('missing');
  });

  it('treats a bare @ as missing without a vault lookup', () => {
    const { store: vault } = createVaultStore();
    expect(resolveScopedPath({ vault }, '@')).toEqual({
      value: undefined,
      status: 'missing',
    });
  });

  it('strips exactly one leading @, so @@gh looks up the literal name "@gh"', () => {
    const { store: vault } = createVaultStore({
      initial: { '@gh': { value: 1, status: 'fresh' } },
    });
    expect(resolveScopedPath({ vault }, '@@gh')).toEqual({
      value: 1,
      status: 'fresh',
      error: undefined,
    });
    // With no such literal name stored, it simply misses (no loop-strip).
    const { store: emptyVault } = createVaultStore();
    expect(resolveScopedPath({ vault: emptyVault }, '@@gh').status).toBe(
      'missing',
    );
  });

  it('degrades an @-name to missing when no vault is supplied', () => {
    expect(resolveScopedPath({}, '@gh.stars')).toEqual({
      value: undefined,
      status: 'missing',
    });
    const store = createValueStore({
      gh: { value: { stars: 42 }, status: 'fresh' },
    });
    expect(resolveScopedPath({ store }, '@gh.stars')).toEqual({
      value: undefined,
      status: 'missing',
    });
  });

  it('reports a stale status from the vault', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: 42, status: 'stale' } },
    });
    expect(resolveScopedPath({ vault }, '@gh').status).toBe('stale');
  });

  it('carries a vault entry error through exactly as the note-local path does', () => {
    const { store: vault } = createVaultStore({
      initial: {
        gh: { value: null, status: 'error', error: 'fetch failed' },
      },
    });
    expect(resolveScopedPath({ vault }, '@gh')).toEqual({
      value: null,
      status: 'error',
      error: 'fetch failed',
    });
  });
});
