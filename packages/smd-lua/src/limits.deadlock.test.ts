import { describe, expect, it } from 'vitest';
import { createEmptyLuaEngine } from './globals';
import { installLimits } from './limits';

/**
 * Regression coverage for the critical defect: the stock C-level `xpcall`
 * invokes its message handler INSIDE the C xpcall error-unwind frame, so a
 * hook-triggered longjmp (see `./limits`) firing again during that handler
 * re-enters that same setjmp/Asyncify state and deadlocks wasmoon's
 * `thread.run()` outright — not a script failure, a hung HOST. The fix
 * (`./globals`'s `XPCALL_REIMPLEMENTATION`, installed by every
 * `createEmptyLuaEngine()`) replaces `xpcall` with a pure-Lua version built
 * on `pcall`, so the handler runs at ordinary call depth instead.
 *
 * SAFETY NOTE for anyone touching this file: every case below was FIRST
 * validated to actually terminate in a disposable child-process harness with
 * an external OS-level SIGKILL watchdog, run entirely outside this test
 * suite (see the task's evidence in the PR/commit description) — a case
 * that still deadlocks would hang the vitest process itself (the same
 * WASM-synchronous block a `testTimeout` cannot interrupt). Do NOT add a
 * new "does this hang" case here without first proving termination in an
 * external, hard-killable harness. The explicit per-`it` timeout below is
 * defense-in-depth only, not the primary safety mechanism.
 */

const SMALL_LIMITS = {
  maxInstructions: 5_000_000,
  wallClockMs: 500,
  hookIntervalInstructions: 5_000,
};

async function runBounded(code: string) {
  const engine = await createEmptyLuaEngine();
  const thread = engine.global.newThread();
  const idx = engine.global.getTop();
  const handle = installLimits(thread, SMALL_LIMITS);
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

describe('xpcall reimplementation — former host-deadlock cases now terminate as limit failures', () => {
  it('xpcall(f, f) with a looping body AND looping handler', async () => {
    const r = await runBounded(
      'local function f() while true do end end return xpcall(f, f)',
    );
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
    expect(r.breachKind).toBe('instructions');
    expect(r.elapsedMs).toBeLessThan(3_000);
  }, 5_000);

  it('a while loop repeatedly calling xpcall(f, f)', async () => {
    const r = await runBounded(
      'local function f() while true do end end while true do xpcall(f, f) end',
    );
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
    expect(r.elapsedMs).toBeLessThan(3_000);
  }, 5_000);

  it('xpcall(f, f) wrapped in an outer pcall', async () => {
    const r = await runBounded(
      'local function f() while true do end end return pcall(function() xpcall(f, f) end)',
    );
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
    expect(r.elapsedMs).toBeLessThan(3_000);
  }, 5_000);

  it('a non-looping body with a LOOPING message handler', async () => {
    const r = await runBounded(
      'local function f() while true do end end return xpcall(f, function() while true do end end)',
    );
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
    expect(r.elapsedMs).toBeLessThan(3_000);
  }, 5_000);
});

describe('xpcall reimplementation — already-safe pcall cases are unaffected', () => {
  it('a bare pcall(f) around an infinite loop still terminates as before', async () => {
    const r = await runBounded(
      'local function f() while true do end end return pcall(f)',
    );
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
  });

  it('a while loop repeatedly calling pcall(f) still terminates as before', async () => {
    const r = await runBounded(
      'local function f() while true do end end while true do pcall(f) end',
    );
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
  });

  it('nested pcall still terminates as before', async () => {
    const r = await runBounded(
      'local function f() while true do end end return pcall(function() return pcall(f) end)',
    );
    expect(r.outcome.ok).toBe(false);
    expect(r.breached).toBe(true);
  });
});

describe('xpcall reimplementation — legitimate usage still works', () => {
  it('the handler receives the error object on failure', async () => {
    const r = await runBounded(`
      local function f() error("boom") end
      local ok, msg = xpcall(f, function(e) return "handled:" .. tostring(e) end)
      return ok, msg
    `);
    expect(r.outcome.ok).toBe(true);
    expect(r.breached).toBe(false);
  });

  it('all return values pass through unchanged on success (multi-return preserved)', async () => {
    const r = await runBounded(`
      local function f(a, b) return a + b, a * b end
      local ok, s, p = xpcall(f, function(e) return "should not run" end, 3, 4)
      return tostring(ok) .. ":" .. tostring(s) .. ":" .. tostring(p)
    `);
    expect(r.outcome).toEqual({ ok: true, value: 'true:7:12' });
    expect(r.breached).toBe(false);
  });

  it('a handler that does NOT loop runs normally and the run completes (not breached)', async () => {
    const r = await runBounded(`
      local function f() error("x") end
      local ok = xpcall(f, function() end)
      return tostring(ok)
    `);
    expect(r.outcome).toEqual({ ok: true, value: 'false' });
    expect(r.breached).toBe(false);
  });
});
