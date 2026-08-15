import { describe, expect, it } from 'vitest';
import { createEmptyLuaEngine } from './globals';
import { installLimits } from './limits';

/**
 * Runs `code` on a fresh engine + dedicated child thread with the
 * instruction/wall-clock hook installed, mirroring exactly what
 * `sandbox.ts` does (minus capabilities/marshaling, which are out of scope
 * for this file — see `sandbox.test.ts` for the end-to-end version).
 * Small limits are used throughout so this suite runs in milliseconds, not
 * seconds, while still genuinely exercising the mechanism.
 */
async function runBounded(
  code: string,
  overrides: {
    maxInstructions?: number;
    wallClockMs?: number;
    hookIntervalInstructions?: number;
  } = {},
) {
  const engine = await createEmptyLuaEngine();
  const thread = engine.global.newThread();
  const idx = engine.global.getTop();
  const handle = installLimits(thread, {
    maxInstructions: overrides.maxInstructions ?? 2_000_000,
    wallClockMs: overrides.wallClockMs ?? 2_000,
    hookIntervalInstructions: overrides.hookIntervalInstructions ?? 5_000,
  });
  const start = Date.now();
  let outcome: { ok: true; value: unknown } | { ok: false; message: string };
  try {
    thread.loadString(code);
    const result = await thread.run(0);
    outcome = { ok: true, value: result.length > 0 ? result[0] : undefined };
  } catch (err) {
    outcome = {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    handle.dispose();
    engine.global.remove(idx);
    engine.global.close();
  }
  return {
    outcome,
    breached: handle.isBreached(),
    breachKind: handle.breachKind(),
    elapsedMs: Date.now() - start,
  };
}

describe('installLimits — normal scripts are unaffected', () => {
  it('a quick, bounded script completes normally and is not marked breached', async () => {
    const r = await runBounded(
      'local s = 0; for i = 1, 1000 do s = s + i end; return s',
    );
    expect(r.outcome).toEqual({ ok: true, value: 500500 });
    expect(r.breached).toBe(false);
  });
});

describe('installLimits — instruction-count kill', () => {
  it('a bare infinite loop (no pcall) is killed and reported as a failure', async () => {
    const r = await runBounded('while true do end', {
      maxInstructions: 500_000,
    });
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
    expect(r.breachKind).toBe('instructions');
  });

  it('a tail-call infinite "recursion" (no real stack growth) is also killed — it is instruction-bound, not stack-bound', async () => {
    // `return rec(n+1)` is a proper tail call in Lua: it never overflows
    // the C stack (verified empirically: without a hook this hangs
    // forever rather than raising "stack overflow"), so this exercises
    // the SAME mechanism as `while true do end`, not a distinct recursion
    // limit.
    const r = await runBounded(
      'local function rec(n) return rec(n + 1) end; return rec(0)',
      {
        maxInstructions: 500_000,
      },
    );
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
    expect(r.breachKind).toBe('instructions');
  });
});

describe('installLimits — the crucial case: pcall cannot swallow the interrupt', () => {
  it("an infinite loop wrapped in the SCRIPT'S OWN pcall still fails the whole run, not just the pcall", async () => {
    const r = await runBounded(
      `
      local ok, err = pcall(function() while true do end end)
      -- If the interrupt were catchable, we would reach here and return normally.
      return "survived:" .. tostring(ok) .. ":" .. tostring(err)
      `,
      { maxInstructions: 500_000 },
    );
    expect(r.breached).toBe(true);
    expect(r.breachKind).toBe('instructions');
    // The whole run is a failure -- the script never gets to return its
    // "survived" string, because the re-escalating hook (count shrunk to 1
    // after the first breach) re-interrupts on the very next instruction
    // after pcall's local catch, well before the script can construct and
    // return that string.
    expect(r.outcome.ok).toBe(false);
  });

  it('the worst case: pcall-wrapped infinite loop inside an outer infinite RETRY loop still terminates quickly as a failure', async () => {
    const r = await runBounded(
      `
      local n = 0
      while true do
        pcall(function() while true do end end)
        n = n + 1
      end
      return n
      `,
      { maxInstructions: 2_000_000 },
    );
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
    // Must terminate quickly (well under a second), not hang or spin for
    // the full duration a naive implementation might take to exhaust the
    // instruction budget one 5,000-instruction hook interval at a time.
    expect(r.elapsedMs).toBeLessThan(2_000);
  });
});

describe('installLimits — wall-clock kill', () => {
  it('kills a compute-bound infinite loop by wall clock even with a huge instruction cap', async () => {
    const r = await runBounded('while true do end', {
      maxInstructions: 5_000_000_000,
      wallClockMs: 150,
      hookIntervalInstructions: 5_000,
    });
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
    expect(r.breachKind).toBe('timeout');
    expect(r.elapsedMs).toBeLessThan(1_000);
  });
});

describe('installLimits — memory cap', () => {
  it('string.rep balloon is rejected as a Lua-level "not enough memory" error, not a process OOM', async () => {
    const engine = await createEmptyLuaEngine();
    engine.global.setMemoryMax(4 * 1024 * 1024); // 4 MiB
    const thread = engine.global.newThread();
    const idx = engine.global.getTop();
    const handle = installLimits(thread, {
      maxInstructions: 50_000_000,
      wallClockMs: 2_000,
      hookIntervalInstructions: 5_000,
    });
    try {
      thread.loadString(`
        local ok, err = pcall(function() return string.rep('x', 200 * 1024 * 1024) end)
        return tostring(ok) .. ":" .. tostring(err)
      `);
      const result = await thread.run(0);
      const value = result[0] as string;
      expect(value.startsWith('false:')).toBe(true);
      expect(value).toContain('memory');
      // The cap did its job: the string was never actually allocated, so
      // reported Lua-side memory usage stays far below the 200MB attempted.
      expect(engine.global.getMemoryUsed()).toBeLessThan(4 * 1024 * 1024);
    } finally {
      handle.dispose();
      engine.global.remove(idx);
      engine.global.close();
    }
  });

  it('unbounded table growth (no pcall) is rejected, not left to grow indefinitely', async () => {
    const engine = await createEmptyLuaEngine();
    engine.global.setMemoryMax(4 * 1024 * 1024); // 4 MiB
    const thread = engine.global.newThread();
    const idx = engine.global.getTop();
    const handle = installLimits(thread, {
      maxInstructions: 50_000_000,
      wallClockMs: 2_000,
      hookIntervalInstructions: 5_000,
    });
    try {
      thread.loadString(`
        local t = {}
        for i = 1, 100000000 do t[i] = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" end
        return #t
      `);
      await expect(thread.run(0)).rejects.toThrow(/memory/);
      expect(engine.global.getMemoryUsed()).toBeLessThan(4 * 1024 * 1024);
    } finally {
      handle.dispose();
      engine.global.remove(idx);
      engine.global.close();
    }
  });
});

describe('installLimits — deep recursion', () => {
  it('genuine (non-tail-call) unbounded recursion overflows the Lua C stack, a safe catchable error', async () => {
    const r = await runBounded(
      `
      local function rec(n) return 1 + rec(n + 1) end
      local ok, err = pcall(rec, 1)
      return tostring(ok) .. ":" .. tostring(err)
      `,
      { maxInstructions: 50_000_000, wallClockMs: 5_000 },
    );
    expect(r.outcome.ok).toBe(true);
    const value = r.outcome.ok ? (r.outcome.value as string) : '';
    expect(value.startsWith('false:')).toBe(true);
    expect(value.toLowerCase()).toContain('stack overflow');
    // A caught stack overflow is not a resource-limit breach in our
    // tracked sense -- Lua's own C-stack guard handled it safely and the
    // script's own pcall observed and survived it, which is fine: no
    // limit was bypassed, nothing was left running.
  });
});

describe('installLimits — dispose is idempotent and safe after the engine closes', () => {
  it('calling dispose twice, and after engine.global.close(), does not throw', async () => {
    const engine = await createEmptyLuaEngine();
    const thread = engine.global.newThread();
    const idx = engine.global.getTop();
    const handle = installLimits(thread, {
      maxInstructions: 1_000_000,
      wallClockMs: 1_000,
      hookIntervalInstructions: 5_000,
    });
    thread.loadString('return 1');
    await thread.run(0);
    engine.global.remove(idx);
    engine.global.close();
    expect(() => handle.dispose()).not.toThrow();
    expect(() => handle.dispose()).not.toThrow();
  });
});
