import type { ScriptView } from '@markii/bundle';
import { LuaReturn, type LuaThread } from 'wasmoon';
import {
  buildCapabilities,
  type CacheProvider,
  type CapabilityTier,
  type NetGrants,
  type NetProvider,
} from './capabilities';
import {
  CAPABILITY_ERROR_TAG,
  MARSHAL_ERROR_TAG,
  ScriptLimitError,
} from './errors';
import type { ScriptFailure, ScriptMarshalReason } from './errors';
import { createEmptyLuaEngine } from './globals';
import { DEFAULT_LIMITS, installLimits, type ScriptLimits } from './limits';
import {
  buildMarshalPrelude,
  DEFAULT_MARSHAL_LIMITS,
  finalizeMarshaledValue,
  type MarshalLimits,
  wrapUserCode,
} from './marshal';

export interface RunScriptOptions {
  code: string;
  /** Spec §8's trigger tier: 'manual' unlocks effectful ops, 'auto' is read-only regardless of what's granted. */
  tier: CapabilityTier;
  net?: NetProvider;
  netGrants?: NetGrants;
  cache?: CacheProvider;
  /** Bundle-scoped filesystem (spec §11), already capability-restricted — see `@markii/bundle`'s `createScriptView`. */
  bundle?: ScriptView;
  maxFetchBytes?: number;
  limits?: Partial<ScriptLimits>;
  marshalLimits?: Partial<MarshalLimits>;
}

export type RunScriptResult =
  { ok: true; value: unknown } | { ok: false; error: ScriptFailure };

/**
 * The wall-clock hard-kill in `./limits` only fires between Lua VM
 * instructions — it cannot observe a script suspended on `:await()`-ing a
 * host-provided async capability call that never resolves (no instructions
 * execute during that wait, so the hook never gets scheduled). This extra
 * margin over `limits.wallClockMs` before the outer race guard below fires
 * gives the IN-VM hook first right of way for the (far more common)
 * compute-bound case, so the two mechanisms don't race each other for the
 * `breachKind` attribution; this guard exists purely as the backstop for
 * the async-hang case the in-VM hook structurally cannot see.
 */
const WALL_CLOCK_GUARD_SLACK_MS = 250;

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Wraps `thread.assertOk` (public wasmoon API, `thread.d.ts`) to capture the
 * raw C-API status code (`LuaReturn`) that `lua_resume`/`lua_pcall` returned
 * for the run, before wasmoon collapses it into a generic `Error`. Returns a
 * getter for that last-seen code, plus a restore function.
 *
 * ## Why this exists: memory-cap breaches were misclassified as `'runtime'`
 *
 * `thread.run()` calls `this.assertOk(resumeResult.result)` exactly once,
 * with the terminal status of the run. When the Lua allocator (the
 * `traceAllocations`-backed custom allocator `./globals` installs, capped by
 * `engine.global.setMemoryMax`) returns null past the cap, the VM raises
 * `LUA_ERRMEM` — `assertOk` sees `LuaReturn.ErrorMem` (4) and throws a plain
 * `Error` whose `.message` is set directly from `lua_tolstring` (skipping
 * the traceback step, since traceback generation itself needs allocation
 * that could also fail under OOM). That message is INDISTINGUISHABLE from
 * an ordinary runtime error's message on the far side — both are plain
 * strings — so without this hook, a genuine memory-cap breach and a
 * script's own `error("not enough memory")` collapse to the exact same
 * shape and there is no reliable way to tell them apart from the message
 * alone.
 *
 * ## Why the status code is non-spoofable (unlike message matching)
 *
 * `LuaReturn.ErrorMem` is the literal C-API return code from
 * `lua_resume`/`lua_pcall` — it is set by the Lua VM's own error-throwing
 * path (`luaD_throw` with `LUA_ERRMEM`) when the allocator fails, and by
 * nothing else. A script calling `error("not enough memory")` raises an
 * ORDINARY Lua error (`LUA_ERRRUN`, code 2) — verified empirically in a
 * throwaway harness: `error('not enough memory')` yields status 2, while an
 * actual allocator-capped allocation yields status 4, with output messages
 * that are otherwise identical strings. A script has no way to make Lua's
 * own C `lua_resume` return `LUA_ERRMEM` other than genuinely exhausting the
 * capped allocator.
 *
 * ## Why this does NOT reclassify a script's own `pcall`-caught OOM
 *
 * When a script wraps the failing allocation in its OWN `pcall`
 * (`pcall(function() return string.rep(...) end)`), the `LUA_ERRMEM` is
 * raised and caught entirely INSIDE that inner `lua_pcall`, at the Lua
 * level — the outer `lua_resume` that `thread.run()` drives still completes
 * with status `LuaReturn.Ok` (the script's own `pcall` returned `false,
 * "not enough memory"` as an ordinary value). `assertOk` is therefore never
 * called with `ErrorMem` in that case, so this hook correctly leaves that
 * case alone — matching the existing (and intentional) behavior asserted in
 * `sandbox.test.ts`'s "memory cap stops a string.rep balloon ... without
 * OOM-ing the process" test, which expects that case to come back as an
 * ordinary successful run (`ok: true, value: 'false'`), not a `'limit'`
 * failure.
 */
function captureAssertOkStatus(thread: LuaThread): {
  lastStatus: () => LuaReturn | undefined;
  restore: () => void;
} {
  const original = thread.assertOk.bind(thread);
  let lastStatus: LuaReturn | undefined;
  thread.assertOk = (result: LuaReturn) => {
    lastStatus = result;
    original(result);
  };
  return {
    lastStatus: () => lastStatus,
    restore: () => {
      thread.assertOk = original;
    },
  };
}

function extractMarshalReason(message: string): ScriptMarshalReason {
  // The tagged reason is always on the SAME LINE as the tag (Lua's
  // `error()` produces "chunkname:line: SMD_MARSHAL:<reason>[:extra]");
  // wasmoon appends a "\nstack traceback:\n..." block after it, which
  // itself contains further colons (e.g. "[string \"...\"]:10:") — take
  // only the first line before splitting on ":", or those traceback
  // colons get mistaken for part of the tag.
  const afterTag = message
    .slice(message.indexOf(MARSHAL_ERROR_TAG) + MARSHAL_ERROR_TAG.length)
    .split('\n')[0];
  const tag = (afterTag ?? '').replace(/^:/, '').split(':')[0]?.trim();
  switch (tag) {
    case 'nodes':
      return 'nodes';
    case 'depth':
      return 'depth';
    case 'cycle':
      return 'cycle';
    case 'key-type':
      return 'key-type';
    case 'type':
      return 'type';
    default:
      return 'type';
  }
}

/**
 * Classifies an error thrown out of `thread.run()` into the discriminated
 * `ScriptFailure` shape. Message-prefix matching (`CAPABILITY_ERROR_TAG`,
 * `MARSHAL_ERROR_TAG`) is used rather than `instanceof` because wasmoon
 * does not preserve JS `Error` subclass identity across the Lua round trip
 * — see the doc comment on those tags in `./errors` for the empirical
 * evidence. Resource-limit breaches are ALL classified separately, BEFORE
 * this function is ever called, via non-spoofable out-of-band signals —
 * never through this message-based path, since a script can trivially
 * forge any message string (e.g. `error("SMD_LIMIT: ...")` or
 * `error("not enough memory")`) but cannot forge these:
 *   - instruction/wall-clock breaches: the JS closure flag from
 *     `./limits`' hook (see `runScript` below);
 *   - the async-hang backstop: `instanceof ScriptLimitError` on the
 *     `Promise.race` guard's own sentinel, which never crosses the Lua
 *     boundary (see the guard's construction in `runScript`);
 *   - memory-cap breaches: the raw `LuaReturn.ErrorMem` C-API status code
 *     captured by `captureAssertOkStatus` (see its doc comment).
 */
function classifyRuntimeError(err: unknown): ScriptFailure {
  const message = describeError(err);
  if (message.includes(CAPABILITY_ERROR_TAG)) {
    return {
      kind: 'capability',
      message: message.replace(`${CAPABILITY_ERROR_TAG}: `, ''),
    };
  }
  if (message.includes(MARSHAL_ERROR_TAG)) {
    return {
      kind: 'marshal',
      reason: extractMarshalReason(message),
      message,
    };
  }
  return { kind: 'runtime', message };
}

/**
 * Runs one Lua script in a fresh, fully isolated sandbox and always tears
 * the engine down before returning — a run never leaves state (globals,
 * memory, hooks) for a later run to inherit. Never throws: every way
 * hostile code can fail comes back as `{ ok: false, error }`, never a raw
 * exception (see `./errors`).
 *
 * Orchestration, in order:
 * 1. `./globals` — fresh engine, curated empty environment (no `os`/`io`/
 *    `require`/etc; see that module for exactly what's kept and why).
 * 2. Memory cap (`engine.global.setMemoryMax`, backed by the
 *    `traceAllocations: true` custom allocator `./globals` requests).
 * 3. `./capabilities` — build the `net`/`cache`/`bundle` Lua tables from
 *    whatever providers/grants/tier this call was given.
 * 4. `./marshal` — inject the trusted node/depth-capped marshal walk that
 *    the wrapped user code's return value is piped through.
 * 5. A dedicated child thread (NOT `engine.doString`, which creates its
 *    own internal thread we'd have no handle to — see `./limits`'s "hooks
 *    are per-thread" note) gets the instruction/wall-clock hook installed,
 *    then runs the wrapped user code.
 * 6. The out-of-band breach flag from step 5's hook is checked
 *    UNCONDITIONALLY and, if set, wins over whatever the run otherwise
 *    reported — see `./limits`'s doc comment for why this is the actual
 *    enforcement point for "not swallowed by the script's own `pcall`".
 * 7. Otherwise, a thrown error is classified by three non-spoofable
 *    out-of-band signals, in order, before ever falling back to
 *    `classifyRuntimeError`'s message-based path: the wall-clock guard's
 *    own `ScriptLimitError` sentinel (`instanceof`, Defect 3), then the
 *    raw `LuaReturn.ErrorMem` status code (Defect 2). A successful return
 *    goes through `finalizeMarshaledValue` for the final NaN/Infinity
 *    check and marker cleanup.
 * 8. `finally`: hook removed, thread popped, engine closed — every path,
 *    including every early return above.
 */
export async function runScript(
  options: RunScriptOptions,
): Promise<RunScriptResult> {
  const limits: ScriptLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const marshalLimits: MarshalLimits = {
    ...DEFAULT_MARSHAL_LIMITS,
    ...options.marshalLimits,
  };

  const engine = await createEmptyLuaEngine();
  engine.global.setMemoryMax(limits.maxMemoryBytes);

  let thread: LuaThread | undefined;
  let threadStackIndex: number | undefined;
  let limitHandle: ReturnType<typeof installLimits> | undefined;
  let guardTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const { rawGlobals, preludeLua } = buildCapabilities({
      tier: options.tier,
      net: options.net,
      netGrants: options.netGrants,
      cache: options.cache,
      bundle: options.bundle,
      maxFetchBytes: options.maxFetchBytes,
    });
    for (const [name, fn] of Object.entries(rawGlobals)) {
      engine.global.set(name, fn);
    }
    if (preludeLua.trim().length > 0) {
      await engine.doString(preludeLua);
    }
    await engine.doString(buildMarshalPrelude(marshalLimits));

    thread = engine.global.newThread();
    threadStackIndex = engine.global.getTop();
    limitHandle = installLimits(thread, limits);

    try {
      thread.loadString(wrapUserCode(options.code));
    } catch (err) {
      return {
        ok: false,
        error: { kind: 'runtime', message: describeError(err) },
      };
    }

    // Identity-based sentinel (Defect 3): this rejects with a
    // `ScriptLimitError` — a class defined and thrown entirely within this
    // module, never round-tripped through Lua — so the `instanceof` check
    // below cannot be spoofed by a script's own `error("...")` call, even
    // one using this exact message text (see the test asserting that
    // distinction). Message-string matching would be spoofable; `instanceof`
    // is not, because unlike the `CAPABILITY_ERROR_TAG`/`MARSHAL_ERROR_TAG`
    // cases in `classifyRuntimeError` (which DO cross the Lua boundary and
    // so lose subclass identity — see `./errors`'s doc comment), this
    // guard's reject() and its catch below are the same JS scope: the error
    // never enters the Lua VM at all.
    const guard = new Promise<never>((_resolve, reject) => {
      guardTimer = setTimeout(() => {
        reject(
          new ScriptLimitError(
            'timeout',
            'wall-clock timeout exceeded (external async guard: a host capability call never resolved)',
          ),
        );
      }, limits.wallClockMs + WALL_CLOCK_GUARD_SLACK_MS);
      guardTimer.unref?.();
    });

    // Defect 2: capture the raw LuaReturn status code for this run so a
    // genuine memory-cap breach can be told apart, non-spoofably, from an
    // ordinary Lua runtime error whose message happens to say "not enough
    // memory" — see `captureAssertOkStatus`'s doc comment.
    const statusCapture = captureAssertOkStatus(thread);

    let runResult:
      { kind: 'ok'; value: unknown } | { kind: 'error'; err: unknown };
    try {
      const values = await Promise.race([thread.run(0), guard]);
      runResult = {
        kind: 'ok',
        value: values.length > 0 ? values[0] : undefined,
      };
    } catch (err) {
      runResult = { kind: 'error', err };
    } finally {
      if (guardTimer) clearTimeout(guardTimer);
      statusCapture.restore();
    }

    // Authoritative check: a resource-limit breach always wins, regardless
    // of whether Lua-level execution otherwise appears to have "succeeded"
    // (a script's own `pcall` can catch and survive the in-VM interrupt
    // Lua-side; it can never see or clear this JS-side flag). See
    // `./limits` for the full reasoning and the empirical evidence.
    if (limitHandle.isBreached()) {
      const kind = limitHandle.breachKind();
      return {
        ok: false,
        error: {
          kind: 'limit',
          limit: kind,
          message: `script exceeded its ${kind ?? 'resource'} limit`,
        },
      };
    }

    if (runResult.kind === 'error') {
      // Defect 3: the external wall-clock guard's own sentinel error,
      // identified by class identity (never by message) — see the guard's
      // construction above.
      if (runResult.err instanceof ScriptLimitError) {
        return {
          ok: false,
          error: {
            kind: 'limit',
            limit: runResult.err.limitKind,
            message: `script exceeded its ${runResult.err.limitKind} limit`,
          },
        };
      }
      // Defect 2: a genuine, uncaught memory-cap breach, identified by the
      // non-spoofable raw LuaReturn status code — see
      // `captureAssertOkStatus`'s doc comment.
      if (statusCapture.lastStatus() === LuaReturn.ErrorMem) {
        return {
          ok: false,
          error: {
            kind: 'limit',
            limit: 'memory',
            message: 'script exceeded its memory limit',
          },
        };
      }
      return { ok: false, error: classifyRuntimeError(runResult.err) };
    }

    const finalized = finalizeMarshaledValue(runResult.value);
    if (!finalized.ok) {
      return {
        ok: false,
        error: {
          kind: 'marshal',
          reason: finalized.reason,
          message: finalized.message,
        },
      };
    }
    return { ok: true, value: finalized.value };
  } finally {
    limitHandle?.dispose();
    if (thread !== undefined && threadStackIndex !== undefined) {
      try {
        if (!engine.global.isClosed()) {
          engine.global.remove(threadStackIndex);
        }
      } catch {
        // Best-effort cleanup only; the engine is closed unconditionally next.
      }
    }
    if (!engine.global.isClosed()) {
      engine.global.close();
    }
  }
}
