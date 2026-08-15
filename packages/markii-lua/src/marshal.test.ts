import { describe, expect, it } from 'vitest';
import { createEmptyLuaEngine } from './globals';
import {
  buildMarshalPrelude,
  DEFAULT_MARSHAL_LIMITS,
  finalizeMarshaledValue,
  wrapUserCode,
} from './marshal';

async function runMarshaled(
  code: string,
  limits: { maxNodes?: number; maxDepth?: number } = {},
) {
  const engine = await createEmptyLuaEngine();
  try {
    await engine.doString(
      buildMarshalPrelude({
        maxNodes: limits.maxNodes ?? DEFAULT_MARSHAL_LIMITS.maxNodes,
        maxDepth: limits.maxDepth ?? DEFAULT_MARSHAL_LIMITS.maxDepth,
      }),
    );
    const thread = engine.global.newThread();
    const idx = engine.global.getTop();
    try {
      thread.loadString(wrapUserCode(code));
      const result = await thread.run(0);
      const raw = result.length > 0 ? result[0] : undefined;
      return { ok: true as const, raw, finalized: finalizeMarshaledValue(raw) };
    } catch (err) {
      return {
        ok: false as const,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      engine.global.remove(idx);
    }
  } finally {
    engine.global.close();
  }
}

describe('marshal — normal values round-trip correctly', () => {
  it('scalars', async () => {
    const num = await runMarshaled('return 42');
    expect(num.ok && num.raw).toBe(42);
    const s = await runMarshaled('return "hello"');
    expect(s.ok && s.raw).toBe('hello');
    const b = await runMarshaled('return true');
    expect(b.ok && b.raw).toBe(true);
    const n = await runMarshaled('return nil');
    expect(n.ok && n.raw).toBeNull();
  });

  it('a normal nested table -> correct JS value (array + object mix)', async () => {
    const r = await runMarshaled(`
      return { name = "repo", stars = 42, tags = {"a", "b", "c"}, meta = { owner = "x" } }
    `);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.finalized).toEqual({
      ok: true,
      value: {
        name: 'repo',
        stars: 42,
        tags: ['a', 'b', 'c'],
        meta: { owner: 'x' },
      },
    });
  });

  it('an array of numbers', async () => {
    const r = await runMarshaled('return {1, 2, 3, 4, 5}');
    expect(r.ok && r.finalized).toEqual({ ok: true, value: [1, 2, 3, 4, 5] });
  });

  it('an empty table marshals to an empty array', async () => {
    const r = await runMarshaled('return {}');
    expect(r.ok && r.finalized).toEqual({ ok: true, value: [] });
  });
});

describe('marshal — rejects non-JSON-safe types (Lua-side, before wasmoon ever sees them)', () => {
  it('a returned function is rejected', async () => {
    const r = await runMarshaled('return function() end');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('MARK_MARSHAL:type:function');
  });

  it('a table containing a function value is rejected', async () => {
    const r = await runMarshaled('return { fn = function() end }');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('MARK_MARSHAL:type:function');
  });
});

describe('marshal — cyclic tables are rejected', () => {
  it('a self-referential table is rejected as a cycle, not hung or silently accepted', async () => {
    const r = await runMarshaled(`
      local t = {}
      t.self = t
      return t
    `);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('MARK_MARSHAL:cycle');
  });

  it('the SAME table appearing twice via different branches (not a cycle) is allowed', async () => {
    const r = await runMarshaled(`
      local shared = { x = 1 }
      return { a = shared, b = shared }
    `);
    expect(r.ok).toBe(true);
    expect(r.ok && r.finalized).toEqual({
      ok: true,
      value: { a: { x: 1 }, b: { x: 1 } },
    });
  });
});

describe('marshal — depth cap', () => {
  it('a deeply nested table beyond maxDepth is rejected quickly', async () => {
    // Built at RUNTIME via a loop, not as a nested table-constructor
    // literal: a sufficiently deep literal hits Lua's own PARSER stack
    // limit ("C stack overflow" while compiling) before our marshal walk
    // ever runs, which would test the wrong thing.
    const start = Date.now();
    const r = await runMarshaled(
      `
      local t = { n = 1 }
      for i = 1, 200 do t = { n = t } end
      return t
      `,
      { maxDepth: 10, maxNodes: 100_000 },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('MARK_MARSHAL:depth');
    expect(Date.now() - start).toBeLessThan(2_000);
  });
});

describe('marshal — node cap (marshaller DoS)', () => {
  it('a table with 1e6 keys is rejected via the node cap quickly, not hung', async () => {
    const start = Date.now();
    const r = await runMarshaled(
      `
      local t = {}
      for i = 1, 1000000 do t[i] = i end
      return t
      `,
      { maxNodes: 5_000 },
    );
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('MARK_MARSHAL:nodes');
    // The whole point: this must be fast (bounded by maxNodes, not by the
    // 1e6 table size). wasmoon's own table->JS conversion of an
    // uncapped 1e6-entry table was measured empirically at ~12 seconds;
    // this must land nowhere near that.
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe('marshal — mixed/sparse tables have no faithful JSON shape and are rejected', () => {
  it('a table mixing integer and string keys is rejected as key-type', async () => {
    const r = await runMarshaled('return {1, 2, x = "y"}');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('MARK_MARSHAL:key-type');
  });

  it('a table keyed by a boolean is rejected as key-type', async () => {
    const r = await runMarshaled('return {[true] = "x"}');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('MARK_MARSHAL:key-type');
  });
});

describe('finalizeMarshaledValue — NaN/Infinity policy', () => {
  it('NaN (0/0) is rejected, not silently coerced to null', async () => {
    const r = await runMarshaled('return 0/0');
    expect(r.ok).toBe(true);
    expect(r.ok && r.finalized).toEqual({
      ok: false,
      reason: 'non-finite-number',
      message: expect.stringContaining('non-finite') as unknown as string,
    });
  });

  it('Infinity (1/0) is rejected', async () => {
    const r = await runMarshaled('return 1/0');
    expect(r.ok).toBe(true);
    expect(r.ok && r.finalized.ok).toBe(false);
  });

  it('a finite number nested inside a table is untouched', () => {
    expect(finalizeMarshaledValue({ a: 1, b: [1, 2, 3] })).toEqual({
      ok: true,
      value: { a: 1, b: [1, 2, 3] },
    });
  });
});
