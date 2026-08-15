import type { ScriptView } from 'smd-bundle';
import type { LuaThread } from 'wasmoon';
import {
  buildCapabilities,
  type CacheProvider,
  type CapabilityTier,
  type NetGrants,
  type NetProvider,
} from './capabilities';
import { CAPABILITY_ERROR_TAG, MARSHAL_ERROR_TAG } from './errors';
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
  /** Bundle-scoped filesystem (spec §11), already capability-restricted — see `smd-bundle`'s `createScriptView`. */
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
 * evidence. Resource-limit breaches are classified separately, BEFORE this
 * function is ever called, via the out-of-band JS flag from `./limits`
 * (see `runScript` below) — never through this message-based path, since
 * that flag can't be spoofed or missed the way a message string could be.
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
 * 7. Otherwise: a thrown error is classified (`classifyRuntimeError`); a
 *    successful return goes through `finalizeMarshaledValue` for the
 *    final NaN/Infinity check and marker cleanup.
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

    const guard = new Promise<never>((_resolve, reject) => {
      guardTimer = setTimeout(() => {
        reject(new Error('SMD_LIMIT: wall-clock timeout exceeded'));
      }, limits.wallClockMs + WALL_CLOCK_GUARD_SLACK_MS);
      guardTimer.unref?.();
    });

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
