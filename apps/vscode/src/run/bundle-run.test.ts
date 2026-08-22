import { describe, expect, it } from 'vitest';
import type { BundleManifest, BundleStorage } from '@markii/bundle';
import {
  buildBundleSnapshot,
  cacheFilesFrom,
  decodeBundleCacheFromStorage,
  encodeBundleCacheForStorage,
  manifestBundleFsGrants,
  manifestNetHosts,
  MAX_PERSISTED_BUNDLE_CACHE_BYTES,
  withPersistedCache,
} from './bundle-run';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A trivial in-memory `BundleStorage` for tests — no path-jail concerns here, `snapshot-storage.test.ts` covers that. */
function fakeStorage(files: Record<string, string>): BundleStorage {
  const map = new Map(
    Object.entries(files).map(([path, text]) => [path, bytesOf(text)]),
  );
  return {
    async read(path) {
      return map.get(path);
    },
    async write(path, data) {
      map.set(path, data);
    },
    async list() {
      return [...map.keys()].sort();
    },
    async exists(path) {
      return map.has(path);
    },
  };
}

describe('buildBundleSnapshot', () => {
  it('collects scripts/, cache/, and assets/ files, but not manifest.json or the document', async () => {
    const storage = fakeStorage({
      'manifest.json': '{"mark":"0.1.0"}',
      'note.mk.md': '# hi',
      'scripts/etl.lua': 'return 1',
      'cache/data.json': '{"a":1}',
      'assets/photo.png': 'binary-ish',
      'other/ignored.txt': 'nope',
    });

    const { files, truncated } = await buildBundleSnapshot(storage);

    expect(truncated).toBe(false);
    expect(Object.keys(files).sort()).toEqual([
      'assets/photo.png',
      'cache/data.json',
      'scripts/etl.lua',
    ]);
    expect(new TextDecoder().decode(files['scripts/etl.lua'])).toBe('return 1');
  });

  it('quietly truncates once the byte budget is exceeded, never throwing', async () => {
    const storage = fakeStorage({
      'scripts/a.lua': 'x'.repeat(10),
      'scripts/b.lua': 'y'.repeat(10),
    });

    const { files, truncated } = await buildBundleSnapshot(storage, {
      maxTotalBytes: 15,
    });

    expect(truncated).toBe(true);
    // First file (sorted order) fits; the second does not.
    expect(files['scripts/a.lua']).toBeDefined();
    expect(files['scripts/b.lua']).toBeUndefined();
  });
});

describe('cacheFilesFrom', () => {
  it('keeps only cache/-prefixed entries', () => {
    const files = {
      'scripts/a.lua': bytesOf('x'),
      'cache/a.json': bytesOf('{}'),
      'cache/nested/b.json': bytesOf('{}'),
      'assets/img.png': bytesOf('x'),
    };
    expect(Object.keys(cacheFilesFrom(files)).sort()).toEqual([
      'cache/a.json',
      'cache/nested/b.json',
    ]);
  });
});

describe('withPersistedCache', () => {
  it('overlays persisted entries onto the base snapshot, persisted winning on collision', () => {
    const base = {
      'cache/a.json': bytesOf('base'),
      'cache/b.json': bytesOf('base-b'),
    };
    const persisted = { 'cache/a.json': bytesOf('persisted') };
    const merged = withPersistedCache(base, persisted);
    expect(new TextDecoder().decode(merged['cache/a.json'])).toBe('persisted');
    expect(new TextDecoder().decode(merged['cache/b.json'])).toBe('base-b');
  });
});

function manifestWith(overrides: Partial<BundleManifest> = {}): BundleManifest {
  return { mark: '0.1.0', ...overrides };
}

describe('manifestNetHosts', () => {
  it('unions get and post hosts, deduplicated and lowercased', () => {
    const manifest = manifestWith({
      permissions: {
        net: {
          get: ['API.example.com'],
          post: ['api.example.com', 'other.com'],
        },
      },
    });
    expect(manifestNetHosts(manifest).sort()).toEqual(
      ['api.example.com', 'other.com'].sort(),
    );
  });

  it('returns [] when nothing is declared', () => {
    expect(manifestNetHosts(manifestWith())).toEqual([]);
  });
});

describe('manifestBundleFsGrants', () => {
  it('returns the declared grants, or [] when none declared', () => {
    expect(
      manifestBundleFsGrants(
        manifestWith({ permissions: { bundle: ['read', 'write:cache/'] } }),
      ),
    ).toEqual(['read', 'write:cache/']);
    expect(manifestBundleFsGrants(manifestWith())).toEqual([]);
  });
});

describe('encodeBundleCacheForStorage / decodeBundleCacheFromStorage', () => {
  it('round-trips a cache file map through base64', () => {
    const files = { 'cache/a.json': bytesOf('{"x":1}') };
    const encoded = encodeBundleCacheForStorage(files);
    expect(encoded).toBeDefined();
    const decoded = decodeBundleCacheFromStorage(encoded);
    expect(new TextDecoder().decode(decoded['cache/a.json'])).toBe('{"x":1}');
  });

  it('drops (returns undefined) an oversize cache rather than partially persisting it', () => {
    const files = {
      'cache/big.json': new Uint8Array(MAX_PERSISTED_BUNDLE_CACHE_BYTES + 1),
    };
    expect(encodeBundleCacheForStorage(files)).toBeUndefined();
  });

  it('decodes a foreign/corrupt stored value to an empty map rather than throwing', () => {
    expect(decodeBundleCacheFromStorage(undefined)).toEqual({});
    expect(decodeBundleCacheFromStorage(null)).toEqual({});
    expect(decodeBundleCacheFromStorage('not an object')).toEqual({});
    expect(decodeBundleCacheFromStorage(['array', 'not', 'map'])).toEqual({});
    expect(decodeBundleCacheFromStorage({ 'cache/a.json': 42 })).toEqual({});
  });
});
