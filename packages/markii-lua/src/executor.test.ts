import { describe, expect, it } from 'vitest';
import type { ScriptLimits } from './limits';
import type { NetProvider } from './capabilities';
import { createLuaExecutor } from './executor';

/** Small limits so the 'limit' case runs fast, matching sandbox.test.ts's pattern. */
const FAST_LIMITS: Partial<ScriptLimits> = {
  maxInstructions: 2_000_000,
  wallClockMs: 500,
  hookIntervalInstructions: 5_000,
  maxMemoryBytes: 8 * 1024 * 1024,
};

describe('createLuaExecutor', () => {
  it('maps a successful run to { ok: true, value }', async () => {
    const executor = createLuaExecutor({ limits: FAST_LIMITS });
    const result = await executor({ code: 'return 2 + 2', tier: 'manual' });
    expect(result).toEqual({ ok: true, value: 4 });
  });

  it("maps an ordinary Lua error to { ok: false, error: { kind: 'runtime' } }", async () => {
    const executor = createLuaExecutor({ limits: FAST_LIMITS });
    const result = await executor({
      code: 'this is not lua (',
      tier: 'manual',
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('runtime');
    expect(!result.ok && typeof result.error.message).toBe('string');
  });

  it("maps a resource-limit breach to { ok: false, error: { kind: 'limit' } }", async () => {
    const executor = createLuaExecutor({ limits: FAST_LIMITS });
    const result = await executor({
      code: 'while true do end',
      tier: 'manual',
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('limit');
  });

  it("maps an unmarshalable return value to { ok: false, error: { kind: 'marshal' } }", async () => {
    const executor = createLuaExecutor({ limits: FAST_LIMITS });
    const result = await executor({
      code: 'return function() end',
      tier: 'manual',
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('marshal');
  });

  it("maps a denied capability to { ok: false, error: { kind: 'capability' } }", async () => {
    const net: NetProvider = {
      get: async () => ({ status: 200, body: '{}' }),
    };
    const executor = createLuaExecutor({
      limits: FAST_LIMITS,
      net,
      netGrants: { get: ['allowed.example.com'], post: [] },
    });
    const result = await executor({
      code: 'return net.fetch_json("https://not-granted.example.com/x")',
      tier: 'manual',
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('capability');
    expect(!result.ok && result.error.message).toContain(
      'not-granted.example.com',
    );
  });

  it('config is closed over and applied to every call', async () => {
    let calls = 0;
    const net: NetProvider = {
      get: async (url) => {
        calls++;
        return { status: 200, body: JSON.stringify({ url }) };
      },
    };
    const executor = createLuaExecutor({
      limits: FAST_LIMITS,
      net,
      netGrants: { get: ['api.example.com'], post: [] },
    });

    const r1 = await executor({
      code: 'return net.fetch_json("https://api.example.com/a").url',
      tier: 'manual',
    });
    const r2 = await executor({
      code: 'return net.fetch_json("https://api.example.com/b").url',
      tier: 'manual',
    });

    expect(r1).toEqual({ ok: true, value: 'https://api.example.com/a' });
    expect(r2).toEqual({ ok: true, value: 'https://api.example.com/b' });
    expect(calls).toBe(2);
  });
});
