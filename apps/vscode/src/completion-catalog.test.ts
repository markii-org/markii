import { describe, expect, it, vi } from 'vitest';
import type { DiscoveredPack } from '@markii/host';
import { createCatalogCache } from './completion-catalog.js';

describe('createCatalogCache', () => {
  it('builds the standard-set catalog from an empty pack list', async () => {
    const cache = createCatalogCache(async () => []);
    const catalog = await cache.get();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((c) => c.source === 'standard')).toBe(true);
  });

  it('caches the built catalog across repeated get() calls', async () => {
    const load = vi.fn(async (): Promise<readonly DiscoveredPack[]> => []);
    const cache = createCatalogCache(load);
    await cache.get();
    await cache.get();
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rebuilds after invalidate()', async () => {
    const load = vi.fn(async (): Promise<readonly DiscoveredPack[]> => []);
    const cache = createCatalogCache(load);
    await cache.get();
    cache.invalidate();
    await cache.get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('degrades to the standard-set-only catalog when load rejects', async () => {
    const cache = createCatalogCache(async () => {
      throw new Error('discovery failed');
    });
    const catalog = await cache.get();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((c) => c.source === 'standard')).toBe(true);
  });

  it('does not cache a failure forever: a later invalidate + successful load recovers', async () => {
    let shouldFail = true;
    const load = async (): Promise<readonly DiscoveredPack[]> => {
      if (shouldFail) throw new Error('discovery failed');
      return [];
    };
    const cache = createCatalogCache(load);
    const first = await cache.get();
    expect(first.every((c) => c.source === 'standard')).toBe(true);

    shouldFail = false;
    cache.invalidate();
    const second = await cache.get();
    expect(second.every((c) => c.source === 'standard')).toBe(true);
  });

  it('deduplicates concurrent get() calls onto one in-flight build', async () => {
    const load = vi.fn(async (): Promise<readonly DiscoveredPack[]> => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [];
    });
    const cache = createCatalogCache(load);
    const [a, b, c] = await Promise.all([
      cache.get(),
      cache.get(),
      cache.get(),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
