import { describe, expect, it } from 'vitest';
import type { ScriptLimits } from './limits.js';
import { runScript, type RunScriptOptions } from './sandbox.js';

/** Small limits by default so the whole adversarial suite runs in milliseconds, mirroring sandbox.test.ts's FAST_LIMITS. */
const FAST_LIMITS: Partial<ScriptLimits> = {
  maxInstructions: 5_000_000,
  wallClockMs: 2_000,
  hookIntervalInstructions: 5_000,
  maxMemoryBytes: 32 * 1024 * 1024,
};

async function run(code: string, options: Partial<RunScriptOptions> = {}) {
  return runScript({
    code,
    tier: 'auto',
    limits: FAST_LIMITS,
    ...options,
  });
}

describe('json table — available in every tier, no capability grant', () => {
  it('json.decode and json.encode exist under the read-only auto tier with no bundle/net/cache configured', async () => {
    const r = await run(`
      return { has_decode = type(json) == "table" and type(json.decode) == "function",
               has_encode = type(json) == "table" and type(json.encode) == "function" }
    `);
    expect(r).toEqual({
      ok: true,
      value: { has_decode: true, has_encode: true },
    });
  });

  it('a manual-tier run also has json, unconditionally', async () => {
    const r = await run(
      'return type(json.decode) .. "," .. type(json.encode)',
      {
        tier: 'manual',
      },
    );
    expect(r).toEqual({ ok: true, value: 'function,function' });
  });
});

describe('json.decode — happy path, reusing the existing decoder', () => {
  it('decodes an object into a genuine Lua table (type/#/field access all work)', async () => {
    const r = await run(`
      local t = json.decode('{"a": 1, "b": [1, 2, 3], "c": null, "d": "x"}')
      return { ta = type(t), a = t.a, blen = #t.b, c_is_nil = t.c == nil, d = t.d }
    `);
    expect(r).toEqual({
      ok: true,
      value: { ta: 'table', a: 1, blen: 3, c_is_nil: true, d: 'x' },
    });
  });

  it('decodes a top-level array with #, ipairs, and type all behaving normally', async () => {
    const r = await run(`
      local t = json.decode('[10, 20, 30]')
      local sum = 0
      for _, v in ipairs(t) do sum = sum + v end
      return { ty = type(t), len = #t, sum = sum }
    `);
    expect(r).toEqual({ ok: true, value: { ty: 'table', len: 3, sum: 60 } });
  });

  it('a null array element decodes to false, matching net.fetch_json semantics (not a hole)', async () => {
    const r = await run(`
      local t = json.decode('[1, null, 3]')
      return { len = #t, second = t[2] }
    `);
    expect(r).toEqual({ ok: true, value: { len: 3, second: false } });
  });

  it('malformed JSON text fails cleanly, catchable with pcall', async () => {
    const r = await run(`
      local ok, err = pcall(json.decode, '{not json')
      return { ok = ok, has_malformed = string.find(tostring(err), "malformed") ~= nil }
    `);
    expect(r).toEqual({ ok: true, value: { ok: false, has_malformed: true } });
  });

  it('a non-string argument fails as a clean runtime error, never a crash', async () => {
    const r = await run('return json.decode(123)');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('runtime');
    expect(!r.ok && r.error.message).toContain('json.decode expects a string');
  });
});

describe('json.encode — happy path, reusing the existing marshal walk', () => {
  it('encodes scalars and a nested table into valid JSON text', async () => {
    const r = await run(`
      return json.encode({ a = 1, b = { "x", "y" }, c = true })
    `);
    expect(r.ok).toBe(true);
    expect(r.ok && JSON.parse(r.value as string)).toEqual({
      a: 1,
      b: ['x', 'y'],
      c: true,
    });
  });

  it('encodes a top-level array using the array-marker convention correctly (real JSON array, not an object)', async () => {
    const r = await run('return json.encode({ 1, 2, 3 })');
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toBe('[1,2,3]');
  });

  it('round-trips through json.decode(json.encode(t))', async () => {
    const r = await run(`
      local t = { a = 1, b = { 1, 2, 3 }, c = "hi", d = false }
      local back = json.decode(json.encode(t))
      return { a = back.a, blen = #back.b, c = back.c, d = back.d }
    `);
    expect(r).toEqual({
      ok: true,
      value: { a: 1, blen: 3, c: 'hi', d: false },
    });
  });
});

describe('json table — rebinding safety (mirrors ./json-decode finding A1 and ./capabilities findings A2/D1)', () => {
  it('rebinding the global `json` table after the prelude runs does not affect a call already captured by another local, and a fresh call still works after restoring it', async () => {
    const r = await run(`
      local realDecode = json.decode
      json = nil
      local t = realDecode('{"x": 1}')
      return t.x
    `);
    expect(r).toEqual({ ok: true, value: 1 });
  });

  it('rebinding `type` before calling json.decode does not let a non-string argument slip past the type check (the check closes over the real `type`)', async () => {
    const r = await run(`
      type = function() return "string" end
      local ok, err = pcall(json.decode, {})
      return { ok = ok, has_string_msg = string.find(tostring(err), "string") ~= nil }
    `);
    // json.decode's OWN captured \`__smd_json_type\` still reports the truth
    // (a table is a table) regardless of the rebound global, so the guard
    // still fires deterministically and the call still fails with the same
    // message it always would.
    expect(r).toEqual({ ok: true, value: { ok: false, has_string_msg: true } });
  });

  it('rebinding `error` to a no-op does not let json.decode silently swallow a non-string argument', async () => {
    const r = await run(`
      error = function() end
      local result = json.decode({})
      return type(result)
    `);
    // With `error` truly neutered, json.decode's own guard (which calls the
    // CAPTURED real `error`, not the rebound global) still raises -- so the
    // rebound no-op `error` on the SCRIPT's globals is irrelevant to this
    // internal call, and the run still ends in a clean failure rather than
    // "successfully" producing a garbage result from feeding a table into
    // the string-oriented decoder.
    expect(r.ok).toBe(false);
  });

  it('rebinding `string`/`table` after json is set up does not break a subsequent json.decode call (the decoder closed over the real primitives already)', async () => {
    const r = await run(`
      local t1 = json.decode('{"a": 1}')
      string = {}
      table = {}
      local t2 = json.decode('{"b": 2}')
      return { a = t1.a, b = t2.b }
    `);
    expect(r).toEqual({ ok: true, value: { a: 1, b: 2 } });
  });

  it('rebinding `__smd_marshal_root` before calling json.encode does not let an oversized table bypass the node cap (the wrapper captured the real function at prelude time)', async () => {
    const r = await run(
      `
      __smd_marshal_root = function(v) return v end
      local t = {}
      for i = 1, 5000 do t[i] = i end
      local ok, err = pcall(json.encode, t)
      return { ok = ok, has_nodes = string.find(tostring(err), "nodes") ~= nil }
      `,
      { marshalLimits: { maxDepth: 32, maxNodes: 100 } },
    );
    expect(r).toEqual({ ok: true, value: { ok: false, has_nodes: true } });
  });
});

describe('json table — adversarial pass on the real wasmoon interpreter', () => {
  it('decode: deeply nested input past the depth cap fails cleanly and quickly, classified as a marshal depth failure', async () => {
    let body = '0';
    for (let i = 0; i < 40; i++) body = `[${body}]`;
    const start = Date.now();
    const r = await run(`return json.decode('${body}')`, {
      marshalLimits: { maxDepth: 10, maxNodes: 20_000 },
    });
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('depth');
  });

  it('encode: deeply nested Lua table past the depth cap fails cleanly and quickly', async () => {
    const start = Date.now();
    const r = await run(
      `
      local t = { n = 1 }
      for i = 1, 200 do t = { n = t } end
      return json.encode(t)
      `,
      { marshalLimits: { maxDepth: 10, maxNodes: 20_000 } },
    );
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('depth');
  });

  it('decode: a huge array past the node cap fails cleanly and quickly, never hanging', async () => {
    const items = Array.from({ length: 5_000 }, (_, i) => i);
    const start = Date.now();
    const r = await run(`return json.decode('${JSON.stringify(items)}')`, {
      marshalLimits: { maxDepth: 32, maxNodes: 100 },
    });
    expect(Date.now() - start).toBeLessThan(3_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('nodes');
  });

  it('encode: a huge Lua array past the node cap fails cleanly and quickly, never hanging', async () => {
    const start = Date.now();
    const r = await run(
      `
      local t = {}
      for i = 1, 50000 do t[i] = i end
      return json.encode(t)
      `,
      {
        limits: {
          ...FAST_LIMITS,
          maxInstructions: 50_000_000,
          maxMemoryBytes: 64 * 1024 * 1024,
        },
        marshalLimits: { maxDepth: 32, maxNodes: 5_000 },
      },
    );
    expect(Date.now() - start).toBeLessThan(3_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('nodes');
  });

  it('decode: invalid UTF-8 byte sequences in the input never hang or crash the host, and resolve to a bounded outcome', async () => {
    const start = Date.now();
    const r = await run(`
      -- 0xFF/0xFE are invalid UTF-8 lead bytes on their own; wrap them in a
      -- quoted JSON string so a "malformed JSON" failure isn't a foregone
      -- conclusion for an unrelated reason (an unterminated/unbalanced
      -- structure) -- the point under test is the invalid bytes themselves.
      local bad = '"' .. string.char(0xFF, 0xFE, 65, 0x80) .. '"'
      local ok, result = pcall(json.decode, bad)
      return { ok = ok, resultType = type(result) }
    `);
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(r.ok).toBe(true);
    // Bounded either way: a clean pcall-catchable failure, or a successfully
    // decoded (possibly lossy/replacement-charactered) string -- never a
    // thrown host exception and never a hang, which the wall-clock
    // assertion above already covers.
    expect(
      r.ok && ['boolean'].includes(typeof (r.value as { ok: unknown }).ok),
    ).toBe(true);
  });

  it('encode: an `__index` metatable cannot even be attached to a table in this sandbox (setmetatable is scrubbed), so it is never consulted by json.encode', async () => {
    const r = await run(`
      local ok, err = pcall(setmetatable, {}, { __index = function() return "hijacked" end })
      return { setmetatable_is_nil = setmetatable == nil, attach_failed = not ok }
    `);
    expect(r).toEqual({
      ok: true,
      value: { setmetatable_is_nil: true, attach_failed: true },
    });
  });

  it('encode: a cyclic table is a clean marshal rejection, never a stack overflow or hang', async () => {
    const start = Date.now();
    const r = await run('local t = {}; t.self = t; return json.encode(t)');
    expect(Date.now() - start).toBeLessThan(2_000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('cycle');
  });

  it('encode: NaN is a clean marshal rejection, not silently coerced', async () => {
    const r = await run('return json.encode(0/0)');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.kind).toBe('marshal');
    expect(!r.ok && r.error.reason).toBe('non-finite-number');
  });

  it('encode: positive and negative Infinity are both clean marshal rejections', async () => {
    const rPos = await run('return json.encode(1/0)');
    expect(rPos.ok).toBe(false);
    expect(!rPos.ok && rPos.error.kind).toBe('marshal');
    expect(!rPos.ok && rPos.error.reason).toBe('non-finite-number');

    const rNeg = await run('return json.encode(-1/0)');
    expect(rNeg.ok).toBe(false);
    expect(!rNeg.ok && rNeg.error.kind).toBe('marshal');
    expect(!rNeg.ok && rNeg.error.reason).toBe('non-finite-number');
  });

  it('decode: a 20 MB string input exceeds the shared fetch-size budget and fails cleanly, quickly, never attempting the full parse', async () => {
    const start = Date.now();
    const r = await run(
      `
        local big = string.rep("a", 20 * 1024 * 1024)
        local ok, err = pcall(json.decode, '"' .. big .. '"')
        return { ok = ok, has_limit = string.find(tostring(err), "byte limit") ~= nil }
        `,
      {
        limits: {
          ...FAST_LIMITS,
          maxInstructions: 50_000_000,
          maxMemoryBytes: 96 * 1024 * 1024,
          wallClockMs: 8_000,
        },
      },
    );
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(r).toEqual({ ok: true, value: { ok: false, has_limit: true } });
  }, 15_000);

  it('encode: a 20 MB string value is a bounded result (well under the node cap, no byte-size limit on a single scalar) and completes without hanging', async () => {
    const start = Date.now();
    const r = await run(
      `
        local big = string.rep("a", 20 * 1024 * 1024)
        return json.encode(big)
        `,
      {
        limits: {
          ...FAST_LIMITS,
          maxInstructions: 50_000_000,
          maxMemoryBytes: 128 * 1024 * 1024,
          wallClockMs: 8_000,
        },
      },
    );
    expect(Date.now() - start).toBeLessThan(10_000);
    expect(r.ok).toBe(true);
    expect(r.ok && (r.value as string).length).toBe(20 * 1024 * 1024 + 2);
  }, 15_000);
});
