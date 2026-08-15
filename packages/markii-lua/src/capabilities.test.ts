import { zipSync } from 'fflate';
import {
  createScriptView,
  openZipBundle,
  type BundleManifest,
} from '@markii/bundle';
import { describe, expect, it } from 'vitest';
import {
  buildCapabilities,
  type CacheEntry,
  type NetResponse,
} from './capabilities';
import { createEmptyLuaEngine } from './globals';

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function run(
  code: string,
  config: Parameters<typeof buildCapabilities>[0],
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const engine = await createEmptyLuaEngine();
  try {
    const { rawGlobals, preludeLua } = buildCapabilities(config);
    for (const [name, fn] of Object.entries(rawGlobals)) {
      engine.global.set(name, fn);
    }
    if (preludeLua.trim().length > 0) {
      await engine.doString(preludeLua);
    }
    const thread = engine.global.newThread();
    const idx = engine.global.getTop();
    try {
      thread.loadString(code);
      const result = await thread.run(0);
      return { ok: true, value: result.length > 0 ? result[0] : undefined };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      engine.global.remove(idx);
    }
  } finally {
    engine.global.close();
  }
}

function fakeNet(get: (url: string) => Promise<NetResponse>) {
  return { get };
}

function fixtureBundle() {
  const bytes = zipSync({
    'note.mk.md': u8('# hello'),
    'manifest.json': u8('{"smd":"0.1.0"}'),
    'assets/x.png': u8('img'),
    'cache/data.json': u8('{}'),
  });
  const storage = openZipBundle(bytes);
  const manifest: BundleManifest = {
    smd: '0.1.0',
    permissions: { bundle: ['read', 'write:cache/'] },
  };
  const view = createScriptView(storage, manifest, {
    bundle: ['read', 'write:cache/'],
  });
  return { storage, view };
}

describe('buildCapabilities — net absent when not granted', () => {
  it('with no net provider at all, `net` is nil', async () => {
    const r = await run('return type(net)', { tier: 'manual' });
    expect(r).toEqual({ ok: true, value: 'nil' });
  });

  it('with a provider but zero granted GET hosts, `net` is nil', async () => {
    const r = await run('return type(net)', {
      tier: 'manual',
      net: fakeNet(async () => ({ status: 200, body: '{}' })),
      netGrants: { get: [], post: [] },
    });
    expect(r).toEqual({ ok: true, value: 'nil' });
  });
});

describe('buildCapabilities — net.fetch_json', () => {
  it('works for a granted host via a fake provider, returning parsed JSON', async () => {
    let calledUrl: string | undefined;
    const r = await run(
      'return net.fetch_json("https://api.example.com/repo").stars',
      {
        tier: 'manual',
        net: fakeNet(async (url) => {
          calledUrl = url;
          return { status: 200, body: '{"stars": 7}' };
        }),
        netGrants: { get: ['api.example.com'], post: [] },
      },
    );
    expect(r).toEqual({ ok: true, value: 7 });
    expect(calledUrl).toBe('https://api.example.com/repo');
  });

  it('rejects a host outside the granted GET list, as a typed capability error', async () => {
    const r = await run('return net.fetch_json("https://evil.example.com/x")', {
      tier: 'manual',
      net: fakeNet(async () => ({ status: 200, body: '{}' })),
      netGrants: { get: ['api.example.com'], post: [] },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('SMD_CAPABILITY');
    expect(!r.ok && r.message).toContain('not granted');
  });

  it('rejects a fetch response over the size cap', async () => {
    const bigBody = JSON.stringify({ blob: 'x'.repeat(1000) });
    const r = await run('return net.fetch_json("https://api.example.com/x")', {
      tier: 'manual',
      net: fakeNet(async () => ({ status: 200, body: bigBody })),
      netGrants: { get: ['api.example.com'], post: [] },
      maxFetchBytes: 100,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('SMD_CAPABILITY');
    expect(!r.ok && r.message).toContain('cap');
  });

  it('rejects a non-JSON response body', async () => {
    const r = await run('return net.fetch_json("https://api.example.com/x")', {
      tier: 'manual',
      net: fakeNet(async () => ({ status: 200, body: 'not json' })),
      netGrants: { get: ['api.example.com'], post: [] },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('not valid JSON');
  });
});

describe('buildCapabilities — tier gate on effectful net ops', () => {
  it("tier 'auto': net.post is absent even though POST hosts are granted; net.fetch_json still works", async () => {
    const r = await run(
      `
      local getResult = net.fetch_json("https://api.example.com/x")
      return type(net.post), getResult.ok
      `,
      {
        tier: 'auto',
        net: {
          get: async () => ({ status: 200, body: '{"ok": true}' }),
          post: async () => ({ status: 200, body: '{}' }),
        },
        netGrants: { get: ['api.example.com'], post: ['api.example.com'] },
      },
    );
    expect(r).toEqual({ ok: true, value: 'nil' });
  });

  it("tier 'manual': net.post is present and works for a granted host", async () => {
    let posted: { url: string; body: string } | undefined;
    const r = await run(
      'return net.post("https://api.example.com/x", "payload").status',
      {
        tier: 'manual',
        net: {
          get: async () => ({ status: 200, body: '{}' }),
          post: async (url, body) => {
            posted = { url, body };
            return { status: 201, body: 'created' };
          },
        },
        netGrants: { get: [], post: ['api.example.com'] },
      },
    );
    expect(r).toEqual({ ok: true, value: 201 });
    expect(posted).toEqual({
      url: 'https://api.example.com/x',
      body: 'payload',
    });
  });

  it("tier 'manual' but host not in the POST grant list: net.post rejects that call", async () => {
    const r = await run(
      'return net.post("https://evil.example.com/x", "payload")',
      {
        tier: 'manual',
        net: {
          get: async () => ({ status: 200, body: '{}' }),
          post: async () => ({ status: 200, body: '' }),
        },
        netGrants: { get: [], post: ['api.example.com'] },
      },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('SMD_CAPABILITY');
  });
});

describe('buildCapabilities — cache.get', () => {
  it('calls fn on a cold/stale cache and stores the result', async () => {
    const store = new Map<string, CacheEntry>();
    let fnCalls = 0;
    const r = await run(
      `
      local function compute() return 99 end
      return cache.get("k", 60, compute)
      `,
      {
        tier: 'manual',
        cache: {
          get: async (key) => store.get(key),
          set: async (key, entry) => {
            fnCalls++;
            store.set(key, entry);
          },
        },
      },
    );
    expect(r).toEqual({ ok: true, value: 99 });
    expect(fnCalls).toBe(1);
    expect(store.get('k')?.value).toBe(99);
  });

  it('returns the cached value without calling fn when fresh', async () => {
    const store = new Map<string, CacheEntry>([
      ['k', { value: 'cached-value', storedAtMs: Date.now() }],
    ]);
    let fnCalled = false;
    const r = await run(
      `
      local function compute() return "should-not-be-called" end
      return cache.get("k", 3600, compute)
      `,
      {
        tier: 'manual',
        cache: {
          get: async (key) => store.get(key),
          set: async () => {
            fnCalled = true;
          },
        },
      },
    );
    expect(r).toEqual({ ok: true, value: 'cached-value' });
    expect(fnCalled).toBe(false);
  });

  it('calls fn when the cached entry has gone stale past ttl', async () => {
    const store = new Map<string, CacheEntry>([
      ['k', { value: 'old-value', storedAtMs: Date.now() - 10_000 }],
    ]);
    let newValueStored: unknown;
    const r = await run(
      `
      local function compute() return "fresh-value" end
      return cache.get("k", 1, compute) -- ttl = 1 second, entry is 10s old
      `,
      {
        tier: 'manual',
        cache: {
          get: async (key) => store.get(key),
          set: async (_key, entry) => {
            newValueStored = entry.value;
          },
        },
      },
    );
    expect(r).toEqual({ ok: true, value: 'fresh-value' });
    expect(newValueStored).toBe('fresh-value');
  });

  it("fn calling net.fetch_json internally works (async capability nested inside cache's Lua-level fn call)", async () => {
    const store = new Map<string, CacheEntry>();
    let fetchCalls = 0;
    const r = await run(
      `
      local function compute()
        local r = net.fetch_json("https://api.example.com/x")
        return r.n
      end
      local v1 = cache.get("k", 60, compute)
      local v2 = cache.get("k", 60, compute)
      return v1 == v2, v1
      `,
      {
        tier: 'manual',
        net: fakeNet(async () => {
          fetchCalls++;
          return { status: 200, body: '{"n": 5}' };
        }),
        netGrants: { get: ['api.example.com'], post: [] },
        cache: {
          get: async (key) => store.get(key),
          set: async (key, entry) => {
            store.set(key, entry);
          },
        },
      },
    );
    expect(r).toEqual({ ok: true, value: true });
    expect(fetchCalls).toBe(1); // second cache.get must hit the cache, not re-fetch
  });
});

describe('buildCapabilities — bundle delegates to a real @markii/bundle ScriptView', () => {
  it('bundle.read/exists work through the granted view', async () => {
    const { view } = fixtureBundle();
    const r = await run(
      `
      local data = bundle.read("assets/x.png")
      local exists = bundle.exists("assets/x.png")
      local missing = bundle.exists("nope.txt")
      return data, exists, missing
      `,
      { tier: 'manual', bundle: view },
    );
    expect(r.ok).toBe(true);
    // MultiReturn truncated to first value by our wrapper in this test
    // harness (see `run` above); this test only needs the first value.
    expect(r.ok && r.value).toBe('img');
  });

  it("tier 'manual': bundle.write to cache/ works through the real path-jail/write policy", async () => {
    const { view, storage } = fixtureBundle();
    const r = await run(
      'bundle.write("cache/out.json", "hello"); return true',
      {
        tier: 'manual',
        bundle: view,
      },
    );
    expect(r).toEqual({ ok: true, value: true });
    const written = await storage.read('cache/out.json');
    expect(written && new TextDecoder().decode(written)).toBe('hello');
  });

  it("tier 'manual': bundle.write to manifest.json is blocked by @markii/bundle's own policy (ScriptCapabilityError), not by this package reimplementing it", async () => {
    const { view } = fixtureBundle();
    const r = await run('bundle.write("manifest.json", "{}"); return true', {
      tier: 'manual',
      bundle: view,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('SMD_CAPABILITY');
  });

  it("tier 'manual': bundle.write to note.mk.md is blocked", async () => {
    const { view } = fixtureBundle();
    const r = await run('bundle.write("note.mk.md", "# hacked"); return true', {
      tier: 'manual',
      bundle: view,
    });
    expect(r.ok).toBe(false);
  });

  it("tier 'auto': bundle.write is entirely absent (read-only tier)", async () => {
    const { view } = fixtureBundle();
    const r = await run('return type(bundle.write)', {
      tier: 'auto',
      bundle: view,
    });
    expect(r).toEqual({ ok: true, value: 'nil' });
  });

  it("tier 'auto': bundle.read still works", async () => {
    const { view } = fixtureBundle();
    const r = await run('return bundle.read("assets/x.png")', {
      tier: 'auto',
      bundle: view,
    });
    expect(r).toEqual({ ok: true, value: 'img' });
  });
});

describe('buildCapabilities — raw handles do not leak as globals after wrapping', () => {
  it('none of the __smd_*_raw names are reachable from the script', async () => {
    const { view } = fixtureBundle();
    const r = await run(
      `
      return type(__smd_net_get_raw), type(__smd_cache_get_raw), type(__smd_bundle_read_raw), type(__smd_bundle_write_raw)
      `,
      {
        tier: 'manual',
        net: fakeNet(async () => ({ status: 200, body: '{}' })),
        netGrants: { get: ['api.example.com'], post: [] },
        cache: {
          get: async () => undefined,
          set: async () => {},
        },
        bundle: view,
      },
    );
    // MultiReturn truncation means we only see the first "nil" here, but
    // that alone already proves the raw net handle is gone; see the
    // isolation-style assertions below for the rest checked individually.
    expect(r).toEqual({ ok: true, value: 'nil' });
  });

  it('each raw handle individually is nil after setup', async () => {
    const { view } = fixtureBundle();
    const config = {
      tier: 'manual' as const,
      net: fakeNet(async () => ({ status: 200, body: '{}' })),
      netGrants: { get: ['api.example.com'], post: [] },
      cache: { get: async () => undefined, set: async () => {} },
      bundle: view,
    };
    for (const name of [
      '__smd_net_get_raw',
      '__smd_cache_get_raw',
      '__smd_cache_set_raw',
      '__smd_now_ms_raw',
      '__smd_bundle_read_raw',
      '__smd_bundle_exists_raw',
      '__smd_bundle_write_raw',
    ]) {
      const r = await run(`return type(${name})`, config);
      expect(r, `expected ${name} to be nil`).toEqual({
        ok: true,
        value: 'nil',
      });
    }
  });
});
