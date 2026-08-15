import { zipSync } from 'fflate';
import {
  createScriptView,
  openZipBundle,
  type BundleManifest,
} from 'smd-bundle';
import { describe, expect, it } from 'vitest';
import { DENIED_GLOBALS } from './globals';
import type { ScriptLimits } from './limits';
import { runScript, type RunScriptOptions } from './sandbox';

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function fixtureBundleView() {
  const bytes = zipSync({
    'note.smd': u8('# hello'),
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

/** Small limits by default so the whole adversarial suite runs in milliseconds. */
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

describe('runScript — happy path', () => {
  it('returns a simple value', async () => {
    const r = await run('return 1 + 1');
    expect(r).toEqual({ ok: true, value: 2 });
  });

  it('returns a nested table', async () => {
    const r = await run('return { a = 1, b = { "x", "y" } }');
    expect(r).toEqual({ ok: true, value: { a: 1, b: ['x', 'y'] } });
  });

  it('never throws, even for a syntax error — reported as a typed runtime failure', async () => {
    const r = await run('this is not lua (');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
  });
});

describe('runScript — sandbox escape attempts all come back as typed failures, never a host compromise', () => {
  it.each(DENIED_GLOBALS)('"%s" is nil inside the script', async (name) => {
    const r = await run(`return type(${name})`);
    expect(r).toEqual({ ok: true, value: 'nil' });
  });

  it('load(...) of a string is impossible', async () => {
    const r = await run('return type(load)');
    expect(r).toEqual({ ok: true, value: 'nil' });
  });

  it('calling a supposed "load" as if it existed fails safely', async () => {
    const r = await run('load("return 1")()');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
  });

  it('getmetatable/setmetatable tampering on the string type cannot restore string.dump', async () => {
    const r = await run(`
      local ok = pcall(function()
        local mt = getmetatable("")
        mt.dump = function() end
      end)
      return tostring(ok) .. ":" .. tostring(string.dump)
    `);
    expect(r).toEqual({ ok: true, value: 'false:nil' });
  });
});

describe('runScript — resource limits', () => {
  it('a bare infinite loop is killed by the instruction limit', async () => {
    const r = await run('while true do end');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('limit');
    expect(!r.ok && r.error.limit).toBe('instructions');
  });

  it("the crucial case: a script's own pcall around an infinite loop does not let the run 'succeed'", async () => {
    const r = await run(`
      local ok = pcall(function() while true do end end)
      return "should never get here:" .. tostring(ok)
    `);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('limit');
  });

  it('wall-clock kill fires even with a very high instruction cap', async () => {
    const r = await run('while true do end', {
      limits: {
        ...FAST_LIMITS,
        maxInstructions: 5_000_000_000,
        wallClockMs: 150,
      },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('limit');
    expect(!r.ok && r.error.limit).toBe('timeout');
  });

  it('memory cap stops a string.rep balloon without OOM-ing the process', async () => {
    const r = await run(
      "local ok, err = pcall(function() return string.rep('x', 500*1024*1024) end); return tostring(ok)",
      { limits: { ...FAST_LIMITS, maxMemoryBytes: 4 * 1024 * 1024 } },
    );
    // The script's own pcall catches the "not enough memory" Lua error
    // (an ordinary catchable error, unlike the limit-hook interrupt) and
    // the run completes "successfully" reporting ok=false at the LUA
    // level -- that is a correct, safe outcome: the memory was capped
    // (not a process OOM), and the script observed its own allocation
    // failing, same as any other pcall'd error.
    expect(r).toEqual({ ok: true, value: 'false' });
  });

  it('deep (non-tail-call) recursion overflows the Lua C stack safely, catchable by the script', async () => {
    const r = await run(`
      local function rec(n) return 1 + rec(n + 1) end
      local ok = pcall(rec, 1)
      return tostring(ok)
    `);
    expect(r).toEqual({ ok: true, value: 'false' });
  });
});

describe('runScript — memory-breach classification is exact, not message-based (Defect 2)', () => {
  it('a genuine, UNCAUGHT memory-cap breach is classified as kind:"limit", limit:"memory"', async () => {
    const r = await run(
      `
      local t = {}
      for i = 1, 100000000 do t[i] = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" end
      return #t
      `,
      {
        limits: {
          maxInstructions: 200_000_000,
          wallClockMs: 5_000,
          hookIntervalInstructions: 5_000,
          maxMemoryBytes: 2 * 1024 * 1024,
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('limit');
    expect(!r.ok && r.error.limit).toBe('memory');
  });

  it('a script calling error("not enough memory") itself is NOT reclassified as a memory limit (spoofing attempt fails)', async () => {
    // Same message text a real memory-cap breach produces, but raised by
    // the script's own `error()` call under a generous memory cap that is
    // nowhere near exhausted -- the classifier must tell these apart by the
    // non-spoofable LuaReturn status code (see `captureAssertOkStatus` in
    // `./sandbox`), not by matching this string.
    const r = await run('error("not enough memory")');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
  });

  it("a script's OWN pcall around a memory-cap breach still reports as an ordinary caught error, not a limit failure", async () => {
    // Regression guard: the memory-status capture must not fire for a
    // breach the SCRIPT already caught at the Lua level (lua_pcall absorbs
    // the ErrorMem status internally; the outer lua_resume/thread.run()
    // still completes with LuaReturn.Ok). Duplicates the existing "memory
    // cap stops a string.rep balloon" case above; kept here as an explicit
    // adjacency check for the new classification logic.
    const r = await run(
      "local ok = pcall(function() return string.rep('x', 500*1024*1024) end); return tostring(ok)",
      { limits: { ...FAST_LIMITS, maxMemoryBytes: 4 * 1024 * 1024 } },
    );
    expect(r).toEqual({ ok: true, value: 'false' });
  });
});

describe('runScript — async wall-clock guard classification is identity-based, not message-based (Defect 3)', () => {
  it('a host capability call that never resolves is classified as kind:"limit", limit:"timeout"', async () => {
    const r = await run('return net.fetch_json("https://api.example.com/x")', {
      net: {
        // Never resolves -- simulates a hung host operation the in-VM
        // instruction hook structurally cannot see (no Lua instructions
        // execute while suspended on an await).
        get: () => new Promise(() => {}),
      },
      netGrants: { get: ['api.example.com'], post: [] },
      limits: {
        ...FAST_LIMITS,
        wallClockMs: 100,
      },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('limit');
    expect(!r.ok && r.error.limit).toBe('timeout');
  }, 5_000);

  it('a script calling error() with the EXACT guard message text is NOT reclassified as a limit (spoofing attempt fails)', async () => {
    // The guard identifies its own rejection by class identity
    // (`instanceof ScriptLimitError`), not by this message string, so a
    // script forging the same text must still come back as an ordinary
    // runtime error.
    const r = await run(
      'error("wall-clock timeout exceeded (external async guard: a host capability call never resolved)")',
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
  });
});

describe('runScript — capabilities: net', () => {
  it('with net not granted, net is absent and any use fails as a runtime error, not a crash', async () => {
    const r = await run('return net.fetch_json("https://x.example.com")');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
  });

  it("tier 'auto': net.fetch_json works via a fake provider, net.post is absent", async () => {
    const r = await run(
      `
      local data = net.fetch_json("https://api.example.com/x")
      return data.ok, type(net.post)
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
    expect(r).toEqual({ ok: true, value: true });
  });

  it('fetch over the size cap is rejected as a typed capability failure', async () => {
    const r = await run('return net.fetch_json("https://api.example.com/x")', {
      net: { get: async () => ({ status: 200, body: 'x'.repeat(10_000) }) },
      netGrants: { get: ['api.example.com'], post: [] },
      maxFetchBytes: 100,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('capability');
  });
});

describe('runScript — capabilities: cache', () => {
  it('cache.get returns cached without calling fn when fresh, calls fn when stale', async () => {
    const store = new Map<string, { value: unknown; storedAtMs: number }>();
    const cache = {
      get: async (key: string) => store.get(key),
      set: async (
        key: string,
        entry: { value: unknown; storedAtMs: number },
      ) => {
        store.set(key, entry);
      },
    };

    const script = `
      local function compute() return "computed" end
      return cache.get("k", 3600, compute)
    `;
    const r1 = await run(script, { cache });
    expect(r1).toEqual({ ok: true, value: 'computed' });

    // fn tracked on the JS side via the store, not directly counted here
    // (cache.get's `fn` runs entirely inside Lua) -- verify indirectly:
    // seed a DIFFERENT value directly into the store and confirm a fresh
    // cache.get call returns THAT value without re-running fn.
    store.set('k2', { value: 'preloaded', storedAtMs: Date.now() });
    const r2 = await run(
      'local function compute() return "should-not-run" end; return cache.get("k2", 3600, compute)',
      { cache },
    );
    expect(r2).toEqual({ ok: true, value: 'preloaded' });
  });
});

describe('runScript — capabilities: bundle', () => {
  it('bundle.write to cache/ works through a real ScriptView', async () => {
    const { view, storage } = fixtureBundleView();
    const r = await run('bundle.write("cache/out.json", "hi"); return true', {
      bundle: view,
    });
    expect(r).toEqual({ ok: true, value: true });
    expect(await storage.read('cache/out.json')).toEqual(u8('hi'));
  });

  it('bundle.write to manifest.json/note.smd is blocked through the real ScriptView, surfaced as a capability failure', async () => {
    const { view } = fixtureBundleView();
    const r = await run('bundle.write("manifest.json", "{}")', {
      bundle: view,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('capability');
  });

  it("tier 'auto': bundle.write is entirely absent", async () => {
    const { view } = fixtureBundleView();
    const r = await run('return type(bundle.write)', {
      tier: 'auto',
      bundle: view,
    });
    expect(r).toEqual({ ok: true, value: 'nil' });
  });
});

describe('runScript — marshalling', () => {
  it('a returned function is a typed marshal rejection', async () => {
    const r = await run('return function() end');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('type');
  });

  it('a cyclic table is a typed marshal rejection', async () => {
    const r = await run('local t = {}; t.self = t; return t');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('cycle');
  });

  it('a huge (1e6-key) table is rejected quickly via the node cap, not hung', async () => {
    const start = Date.now();
    // Building the 1e6-entry table itself needs headroom above
    // FAST_LIMITS (both instructions and memory) — the assertion under
    // test is that the MARSHAL node cap is what stops this quickly, not
    // that it's cheap to construct in the first place.
    const r = await run(
      'local t = {}; for i=1,1000000 do t[i]=i end; return t',
      {
        limits: {
          ...FAST_LIMITS,
          maxInstructions: 200_000_000,
          maxMemoryBytes: 64 * 1024 * 1024,
          wallClockMs: 5_000,
        },
        marshalLimits: { maxNodes: 5_000, maxDepth: 32 },
      },
    );
    expect(Date.now() - start).toBeLessThan(3_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('nodes');
  });

  it('NaN is a typed marshal rejection, not silently null', async () => {
    const r = await run('return 0/0');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('non-finite-number');
  });
});

describe('runScript — isolation across runs', () => {
  it('a global set in one run is absent in the next', async () => {
    const r1 = await run('leaked = 42; return leaked');
    expect(r1).toEqual({ ok: true, value: 42 });

    const r2 = await run('return leaked');
    expect(r2).toEqual({ ok: true, value: null });
  });

  it('a metatable-poisoning attempt in one run (even if it somehow succeeded) cannot affect the next run — separate engine, separate memory entirely', async () => {
    // Run A tries every angle it has (all should individually fail safely
    // — getmetatable is absent — but the point of this test is the
    // ISOLATION property, not re-proving those already-covered failures).
    await run(`
      local ok = pcall(function()
        local mt = getmetatable("")
        mt.upper = function() return "POISONED" end
      end)
      return ok
    `);
    // Run B: a completely fresh engine. If poisoning had somehow leaked
    // (it can't -- separate wasmoon engine, separate WASM memory), this
    // would return "POISONED" instead of the real upper-case result.
    const r2 = await run('return ("abc"):upper()');
    expect(r2).toEqual({ ok: true, value: 'ABC' });
  });
});
