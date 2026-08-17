import { zipSync } from 'fflate';
import {
  createScriptView,
  openZipBundle,
  type BundleManifest,
} from '@markii/bundle';
import { describe, expect, it } from 'vitest';
import type { NetProvider } from './capabilities';
import type { ScriptLimits } from './limits';
import { runScript, type RunScriptOptions } from './sandbox';

/**
 * THE FORGERY BATTERY (Phase E item E1). Every test here runs against the
 * REAL wasmoon sandbox — no mocked executor, no stubbed `classifyRuntimeError`
 * — and asserts that a script can NEVER talk its way into a more
 * privileged-sounding `ScriptFailure.kind`/`capability` than what genuinely
 * happened during its own run. The whole point of the JS-closure
 * (`CapabilityDenials`, `./capabilities`) and status-code
 * (`LuaReturn.ErrorMem`, `./sandbox`) discipline is that these signals never
 * cross the Lua boundary — a script's own `error("...")` call, however
 * cleverly worded, cannot set them.
 */

const FAST_LIMITS: Partial<ScriptLimits> = {
  maxInstructions: 2_000_000,
  wallClockMs: 500,
  hookIntervalInstructions: 5_000,
  maxMemoryBytes: 8 * 1024 * 1024,
};

async function run(code: string, options: Partial<RunScriptOptions> = {}) {
  return runScript({
    code,
    tier: 'manual',
    limits: FAST_LIMITS,
    ...options,
  });
}

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function fixtureBundleView() {
  const bytes = zipSync({
    'note.mk.md': u8('# hello'),
    'manifest.json': u8('{"mark":"0.1.0"}'),
    'assets/x.png': u8('img'),
    'cache/data.json': u8('{}'),
  });
  const storage = openZipBundle(bytes);
  const manifest: BundleManifest = {
    mark: '0.1.0',
    permissions: { bundle: ['read', 'write:cache/'] },
  };
  const view = createScriptView(storage, manifest, {
    bundle: ['read', 'write:cache/'],
  });
  return { storage, view };
}

describe('forgery battery: a script can never fake a capability failure by forging a message', () => {
  it('error("MARK_CAPABILITY: ...") with no real denial classifies as an ordinary runtime error, never kind: capability', async () => {
    const r = await run(
      'error("MARK_CAPABILITY: net access to host \\"evil.com\\" not granted")',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
    expect(!r.ok && r.error.capability).toBeUndefined();
  });

  it('error() reproducing the EXACT text a real GET denial produces still classifies as runtime, absent a genuine denial', async () => {
    const r = await run(
      'error("MARK_CAPABILITY: net access to host \\"evil.example.com\\" not granted for GET")',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
  });

  it('a forged tier-block phrasing classifies as runtime, never tier-blocked', async () => {
    const r = await run(
      'error("MARK_CAPABILITY: net.post is granted but not permitted under the read-only auto tier (requires a manual run)")',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
    expect(!r.ok && r.error.capability).toBeUndefined();
  });

  it('error("MARK_LIMIT: ...") with no real breach classifies as runtime, never limit', async () => {
    const r = await run('error("MARK_LIMIT: instructions limit exceeded")');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
  });

  it('a forged "script exceeded its timeout limit" message classifies as runtime, never limit', async () => {
    const r = await run('error("script exceeded its timeout limit")');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
  });

  it('a forged "not enough memory" message classifies as runtime, never limit', async () => {
    const r = await run('error("not enough memory")');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
  });
});

describe('forgery battery: genuine capability denials classify correctly', () => {
  it('a real denial (GET to a host outside netGrants.get) classifies as capability/denied', async () => {
    const net: NetProvider = { get: async () => ({ status: 200, body: '{}' }) };
    const r = await run('return net.fetch_json("https://evil.example.com/x")', {
      net,
      netGrants: { get: ['allowed.example.com'], post: [] },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('capability');
    expect(!r.ok && r.error.capability).toBe('denied');
  });

  it('a real fetch-size-cap denial classifies as capability/denied', async () => {
    const net: NetProvider = {
      get: async () => ({ status: 200, body: 'x'.repeat(1000) }),
    };
    const r = await run('return net.fetch_json("https://api.example.com/x")', {
      net,
      netGrants: { get: ['api.example.com'], post: [] },
      maxFetchBytes: 10,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('capability');
    expect(!r.ok && r.error.capability).toBe('denied');
  });

  it('a real bundle path-jail denial classifies as capability/denied', async () => {
    const { view } = fixtureBundleView();
    const r = await run('bundle.write("manifest.json", "{}")', {
      bundle: view,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('capability');
    expect(!r.ok && r.error.capability).toBe('denied');
  });
});

describe('forgery battery: genuine tier blocks classify correctly, distinct from denial', () => {
  it("a real tier block (net.post granted, provider present, tier 'auto') classifies as capability/tier-blocked, not capability/denied or runtime", async () => {
    const net: NetProvider = {
      get: async () => ({ status: 200, body: '{}' }),
      post: async () => ({ status: 200, body: '{}' }),
    };
    const r = await run('return net.post("https://api.example.com/x", "p")', {
      tier: 'auto',
      net,
      netGrants: { get: [], post: ['api.example.com'] },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('capability');
    expect(!r.ok && r.error.capability).toBe('tier-blocked');
  });

  it('a real tier block on net.patch classifies as capability/tier-blocked', async () => {
    const net: NetProvider = {
      get: async () => ({ status: 200, body: '{}' }),
      patch: async () => ({ status: 200, body: '{}' }),
    };
    const r = await run('return net.patch("https://api.example.com/x", "p")', {
      tier: 'auto',
      net,
      netGrants: { get: [], post: ['api.example.com'] },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('capability');
    expect(!r.ok && r.error.capability).toBe('tier-blocked');
  });

  it("a real tier block on bundle.write (bundle view supplied, tier 'auto') classifies as capability/tier-blocked", async () => {
    const { view, storage } = fixtureBundleView();
    const r = await run('bundle.write("cache/out.json", "hi")', {
      tier: 'auto',
      bundle: view,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('capability');
    expect(!r.ok && r.error.capability).toBe('tier-blocked');
    expect(await storage.read('cache/out.json')).toBeUndefined();
  });
});

describe('forgery battery: genuine resource-limit kills classify correctly', () => {
  it('a real instruction-limit kill (tight loop, small maxInstructions) classifies as limit', async () => {
    const r = await run('local i = 0; while true do i = i + 1 end', {
      limits: {
        maxInstructions: 50_000,
        wallClockMs: 5_000,
        hookIntervalInstructions: 1_000,
        maxMemoryBytes: 8 * 1024 * 1024,
      },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('limit');
    expect(!r.ok && r.error.limit).toBe('instructions');
  });

  it('a script pcall-wrapping an infinite loop and retrying still ends up classified as limit, not a script-controlled success', async () => {
    const r = await run(
      'local n = 0; while true do pcall(function() while true do end end); n = n + 1 end',
      {
        limits: {
          maxInstructions: 5_000_000,
          wallClockMs: 2_000,
          hookIntervalInstructions: 5_000,
          maxMemoryBytes: 8 * 1024 * 1024,
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('limit');
  });
});

describe("forgery battery: a denial swallowed by the script's own pcall, followed by success, is a genuine ok:true (no failure at all)", () => {
  it('pcall around a real denial, then a normal return: ok:true, the swallowed denial never surfaces', async () => {
    const net: NetProvider = { get: async () => ({ status: 200, body: '{}' }) };
    const r = await run(
      `
      local ok, err = pcall(net.fetch_json, "https://evil.example.com/x")
      return { caught = not ok, answer = 42 }
      `,
      {
        net,
        netGrants: { get: ['allowed.example.com'], post: [] },
      },
    );
    expect(r).toEqual({ ok: true, value: { caught: true, answer: 42 } });
  });

  it('pcall around a real tier-blocked net.post, then a normal return: ok:true', async () => {
    const net: NetProvider = {
      get: async () => ({ status: 200, body: '{}' }),
      post: async () => ({ status: 200, body: '{}' }),
    };
    const r = await run(
      `
      local ok = pcall(net.post, "https://api.example.com/x", "p")
      return { caught = not ok, answer = 7 }
      `,
      {
        tier: 'auto',
        net,
        netGrants: { get: [], post: ['api.example.com'] },
      },
    );
    expect(r).toEqual({ ok: true, value: { caught: true, answer: 7 } });
  });

  it("known accepted edge: a genuine denial swallowed by pcall, followed by the SCRIPT'S OWN unrelated error, is still attributed to the genuine denial (last-denial-wins), never demoted to a plain runtime error", async () => {
    const net: NetProvider = { get: async () => ({ status: 200, body: '{}' }) };
    const r = await run(
      `
      pcall(net.fetch_json, "https://evil.example.com/x")
      error("totally unrelated script bug")
      `,
      {
        net,
        netGrants: { get: ['allowed.example.com'], post: [] },
      },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('capability');
    expect(!r.ok && r.error.capability).toBe('denied');
  });
});
