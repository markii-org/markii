import { describe, expect, it } from 'vitest';
import { createValueStore, createVaultStore } from '@markii/runtime';
import { resolveScopedPath, resolveStorePath, safeRead } from './resolve.js';

describe('resolveStorePath', () => {
  it('resolves a bare name directly', () => {
    const store = createValueStore({ stars: { value: 7, status: 'fresh' } });
    expect(resolveStorePath(store, 'stars')).toEqual({
      value: 7,
      status: 'fresh',
      error: undefined,
      failureKind: undefined,
    });
  });

  it('walks a dotted path into a stored object', () => {
    const store = createValueStore({
      repo: { value: { stars: 42 }, status: 'fresh' },
    });
    const resolved = resolveStorePath(store, 'repo.stars');
    expect(resolved.value).toBe(42);
    expect(resolved.status).toBe('fresh');
  });

  it('an unresolved path segment degrades to missing, carrying the root error/kind through', () => {
    const store = createValueStore({
      repo: {
        value: { stars: 1 },
        status: 'error',
        error: 'boom',
        failureKind: 'script-error',
      },
    });
    const resolved = resolveStorePath(store, 'repo.nope');
    expect(resolved.status).toBe('missing');
    expect(resolved.error).toBe('boom');
    expect(resolved.failureKind).toBe('script-error');
  });

  it('a __proto__/constructor path segment never resolves through the prototype chain', () => {
    const store = createValueStore({ repo: { value: {}, status: 'fresh' } });
    expect(resolveStorePath(store, 'repo.__proto__').status).toBe('missing');
    expect(resolveStorePath(store, 'repo.constructor').status).toBe('missing');
  });

  it('no store degrades to missing without throwing', () => {
    expect(resolveStorePath(undefined, 'stars')).toEqual({
      value: undefined,
      status: 'missing',
    });
  });

  it('a throwing store.get degrades to missing, carrying the thrown message', () => {
    const hostile = {
      get(): never {
        throw new Error('store exploded');
      },
      has: () => false,
      set: () => undefined,
      snapshot: () => ({}),
    };
    const resolved = resolveStorePath(hostile, 'stars');
    expect(resolved.status).toBe('missing');
    expect(resolved.error).toBe('store exploded');
    expect(resolved.failureKind).toBeUndefined();
  });

  it('an empty root name never resolves', () => {
    const store = createValueStore({ x: { value: 1, status: 'fresh' } });
    expect(resolveStorePath(store, '').status).toBe('missing');
  });
});

describe('resolveScopedPath', () => {
  it('an @-prefixed name resolves against the vault, not the store', () => {
    const { store: vault, writer } = createVaultStore();
    void writer.publish('gh', { value: 100, status: 'fresh' });
    const store = createValueStore({ gh: { value: 1, status: 'fresh' } });

    const resolved = resolveScopedPath({ store, vault }, '@gh');
    expect(resolved.value).toBe(100);
  });

  it('an @-prefixed name with no vault configured degrades to missing, never falling back to the store', () => {
    const store = createValueStore({ gh: { value: 1, status: 'fresh' } });
    expect(resolveScopedPath({ store }, '@gh').status).toBe('missing');
  });

  it('a bare @ resolves to missing without a lookup', () => {
    const { store: vault } = createVaultStore();
    expect(resolveScopedPath({ vault }, '@').status).toBe('missing');
  });

  it('a double @@ looks up the literal vault name "@gh", which simply misses', () => {
    const { store: vault, writer } = createVaultStore();
    void writer.publish('@gh', { value: 5, status: 'fresh' });
    void writer.publish('gh', { value: 1, status: 'fresh' });
    expect(resolveScopedPath({ vault }, '@@gh').value).toBe(5);
  });

  it('a dotted @-path walks into the vault entry', () => {
    const { store: vault, writer } = createVaultStore();
    void writer.publish('gh', { value: { stars: 9 }, status: 'fresh' });
    expect(resolveScopedPath({ vault }, '@gh.stars').value).toBe(9);
  });
});

describe('safeRead', () => {
  it('returns the read result when it does not throw', () => {
    expect(
      safeRead(
        () => 42,
        () => 0,
      ),
    ).toEqual({ fields: 42 });
  });

  it('falls back and reports the thrown message when read throws', () => {
    const result = safeRead<number>(
      () => {
        throw new Error('kaboom');
      },
      () => -1,
    );
    expect(result).toEqual({ fields: -1, fault: 'kaboom' });
  });
});
