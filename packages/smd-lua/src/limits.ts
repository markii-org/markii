import { LuaEventMasks, type LuaThread } from 'wasmoon';
import type { ScriptLimitKind } from './errors';

/** Resource limits for one `runScript` call. All configurable; defaults are conservative. */
export interface ScriptLimits {
  /** Lua VM instructions before the run is killed. Default 100,000,000. */
  maxInstructions: number;
  /** Wall-clock milliseconds before the run is killed. Default 5,000. */
  wallClockMs: number;
  /** Bytes the Lua allocator may hand out before allocations start failing. Default 32 MiB. */
  maxMemoryBytes: number;
  /**
   * VM instructions between hook firings (the `count` argument to
   * `lua_sethook`'s `LUA_MASKCOUNT`). Smaller = finer-grained wall-clock
   * checks and lower overshoot past `maxInstructions`, at the cost of more
   * hook-call overhead per instruction executed. Default 10,000.
   */
  hookIntervalInstructions: number;
}

export const DEFAULT_LIMITS: ScriptLimits = {
  maxInstructions: 100_000_000,
  wallClockMs: 5_000,
  maxMemoryBytes: 32 * 1024 * 1024,
  hookIntervalInstructions: 10_000,
};

export interface LimitHandle {
  /** True once the instruction/wall-clock hook has fired at least once. Authoritative: check this after every run, regardless of the run's apparent outcome (see the module doc comment). */
  isBreached(): boolean;
  breachKind(): ScriptLimitKind | undefined;
  /** Removes the WASM function pointer and clears the hook. Must be called exactly once, in the run's `finally`. */
  dispose(): void;
}

/**
 * Installs the instruction-count + wall-clock interrupt on `thread` (a
 * dedicated child thread from `engine.global.newThread()` — see the "hooks
 * are per-thread" note below) and returns a handle to read/tear it down.
 *
 * ## Why this exists instead of wasmoon's own `Thread.setTimeout`/`run({
 * timeout })`
 *
 * wasmoon ships a built-in mechanism (`Thread.setTimeout`, used internally
 * by `run({ timeout })`): it installs a `lua_sethook` count hook that, once
 * `Date.now() > deadline`, pushes a `LuaTimeoutError` and calls
 * `lua_error`. That is a completely ordinary Lua error from the VM's point
 * of view — indistinguishable from a script calling `error("x")` itself —
 * which means it is fully catchable by `pcall`:
 *
 * ```lua
 * pcall(function() while true do end end)  -- catches the timeout, keeps going
 * ```
 *
 * This is exactly the case the task calls out as "the crucial one": the
 * interrupt must abort the WHOLE RUN, not be swallowed by the script's own
 * `pcall`. Verified empirically against wasmoon 1.16.0 — a script that
 * `pcall`s an infinite loop and then keeps running afterward completes
 * "successfully" under wasmoon's own `setTimeout`/`run({timeout})`
 * mechanism; the timeout is silently absorbed.
 *
 * ## The fix: an out-of-band JS flag, plus shrinking the hook interval to 1
 *
 * This hook does two things wasmoon's built-in one doesn't:
 *
 * 1. It sets a plain JS closure variable (`breached`) the instant the limit
 *    is first exceeded. This flag lives entirely on the JS side — no Lua
 *    value, no metatable, no `pcall` can ever see or clear it. `sandbox.ts`
 *    checks this flag UNCONDITIONALLY after every run and overrides the
 *    result to a hard `ScriptLimitError` if it's set, regardless of what
 *    the Lua-level call returned or whether a `pcall` inside the script
 *    reported "success". This is the actual enforcement point — not the
 *    Lua-level error the hook also raises (see next point).
 * 2. On the FIRST breach, it re-installs the hook with `count = 1` (fires
 *    on literally every subsequent VM instruction, not just every
 *    `hookIntervalInstructions`). Combined with the hook continuing to
 *    call `lua_error` every time it fires, this makes forward progress
 *    after a breach exceedingly hard: even a script that wraps the
 *    offending loop in its own `pcall` and immediately retries in an outer
 *    loop gets re-interrupted after (usually) a single VM instruction, so
 *    the error re-escalates and reaches the top of the call stack (a
 *    frame with no enclosing `pcall`) almost immediately. Verified
 *    empirically: `local n=0; while true do pcall(function() while true do
 *    end end); n=n+1 end` — the worst case in the adversarial suite,
 *    combining an inner `pcall`-wrapped infinite loop with an outer
 *    infinite retry loop — still terminates (as a hard failure, `n` never
 *    returned) in under 100ms with `maxInstructions = 5,000,000`.
 *
 * Point 2 is a strong practical deterrent but is NOT a formal proof of
 * "zero possible forward progress after breach" — a script could in
 * principle structure code so that literally every single VM instruction
 * after the breach happens inside its own fresh `pcall` frame (each
 * `pcall` call itself is several instructions, some of which execute
 * outside any protection while the closure/call frame is being set up).
 * Point 1 is what actually closes the loophole: even in that
 * (implausible, and in practice never observed) worst case, the run's
 * *reported outcome* is still forced to a limit failure by the JS-side
 * flag, which the script has no way to reach or clear. **Solid** claim:
 * the reported result of a breached run is always a limit failure, never
 * a script-controlled "success" — but this was verified against `pcall`
 * specifically, and does NOT generalize to every Lua construct that can
 * catch an error. It was FALSE, for one such construct, until a separate
 * fix landed: the stock C `xpcall` invokes its message handler WHILE still
 * inside the C-level xpcall error-unwind frame, and a hook-triggered
 * longjmp firing again during that handler (trivial once the hook has
 * tightened to `count = 1` after the first breach) re-enters that same
 * setjmp/Asyncify state and deadlocks wasmoon's `thread.run()` outright —
 * not a script-controlled "success", but a hung HOST, which is worse. That
 * specific hole is closed by replacing `xpcall` with a pure-Lua
 * reimplementation built on `pcall` (see `./globals`'s
 * `XPCALL_REIMPLEMENTATION`), so the message handler runs at ordinary Lua
 * call depth instead of inside the C xpcall frame, where a re-firing hook
 * behaves exactly like the already-safe `pcall` case. **Best-effort, not
 * airtight** claim, even with that fix: the breached script's own further
 * CPU consumption is curtailed almost immediately, not provably instantly,
 * and this in-VM hook is fundamentally a cooperative, best-effort
 * mechanism — it only runs BETWEEN Lua VM instructions and cannot preempt
 * a single WASM-synchronous hang (whether from an as-yet-undiscovered catch
 * construct with the same nested-frame shape as the old `xpcall`, or from
 * something outside the VM's own instruction stream entirely). The
 * AUTHORITATIVE kill for that class of failure is not this hook at all —
 * it's the host's EXTERNAL, terminatable-isolate watchdog (dedicated Web
 * Worker/`worker_thread` + an outside wall-clock timer calling
 * `terminate()`), now normative in DESIGN.md §10 ("In-process limits are
 * best-effort; the terminatable isolate is the real guarantee"). This
 * module's hook reduces how often that external kill is needed and gives
 * fast, precise, in-band error classification for the common compute-bound
 * case; it is not, and cannot be, a substitute for the external watchdog.
 *
 * ## Why hooks are per-thread, and why that matters here
 *
 * `lua_sethook` sets the hook on the specific `lua_State` passed to it.
 * `engine.doString()` internally creates a NEW child thread via
 * `engine.global.newThread()` and runs the script there — a hook installed
 * on `engine.global.address` would never fire for code run through
 * `doString`. `sandbox.ts` therefore does NOT use `engine.doString()` for
 * the untrusted script; it creates the child thread itself (mirroring what
 * `doString` does internally) so it can install this hook on that exact
 * thread before loading/running the script.
 *
 * ## Wall-clock accuracy
 *
 * The wall-clock check only runs when the hook fires — i.e. every
 * `hookIntervalInstructions` VM instructions. This is not a true
 * OS-level preemption (nothing in wasmoon offers that inside a single JS
 * thread); it bounds overshoot to "however long `hookIntervalInstructions`
 * takes to execute", which for the default of 10,000 is sub-millisecond on
 * ordinary hardware. It does NOT protect against a single hung *host*
 * operation (e.g. a capability call that never resolves its promise) —
 * that's a separate concern handled by the `Promise.race` wall-clock guard
 * in `sandbox.ts`, since Lua isn't executing any instructions while
 * suspended on an `await`, so this hook simply never fires during that
 * window.
 */
export function installLimits(
  thread: LuaThread,
  limits: Pick<
    ScriptLimits,
    'maxInstructions' | 'wallClockMs' | 'hookIntervalInstructions'
  >,
): LimitHandle {
  let breached = false;
  let kind: ScriptLimitKind | undefined;
  let instructionsSeen = 0;
  let hookInterval = limits.hookIntervalInstructions;
  const deadline = Date.now() + limits.wallClockMs;

  const hookPointer = thread.lua.module.addFunction(() => {
    instructionsSeen += hookInterval;
    if (!breached) {
      if (instructionsSeen >= limits.maxInstructions) {
        breached = true;
        kind = 'instructions';
      } else if (Date.now() >= deadline) {
        breached = true;
        kind = 'timeout';
      }
      if (breached) {
        // Tighten the hook so every subsequent instruction re-triggers —
        // see the module doc comment ("point 2").
        hookInterval = 1;
        thread.lua.lua_sethook(
          thread.address,
          hookPointer,
          LuaEventMasks.Count,
          1,
        );
      }
    }
    if (breached) {
      thread.pushValue(`SMD_LIMIT: ${kind ?? 'instructions'} limit exceeded`);
      thread.lua.lua_error(thread.address);
    }
    // Unreachable in practice: lua_error longjmps and never returns here.
  }, 'vii');

  thread.lua.lua_sethook(
    thread.address,
    hookPointer,
    LuaEventMasks.Count,
    limits.hookIntervalInstructions,
  );

  let disposed = false;
  return {
    isBreached: () => breached,
    breachKind: () => kind,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (!thread.isClosed()) {
        thread.lua.lua_sethook(thread.address, null, 0, 0);
      }
      thread.lua.module.removeFunction(hookPointer);
    },
  };
}
