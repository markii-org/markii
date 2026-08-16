import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { resolveStorePath } from './store-path';

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
