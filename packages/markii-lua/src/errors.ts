/**
 * Typed failure taxonomy for `runScript` (see `./sandbox`). Running hostile
 * Lua must never throw a raw/opaque exception out of this package — every
 * failure mode a script can trigger (resource limits, capability denial,
 * an unmarshalable return value, or an ordinary Lua runtime error) is
 * classified into one of these kinds before it reaches the caller.
 *
 * IMPORTANT CONSTRAINT this module works around: wasmoon does not preserve
 * JS `Error` subclass identity across a round trip through the Lua VM. A
 * custom `Error` thrown from a host-provided async capability function (see
 * `./capabilities`) comes back out of `thread.run()` as a plain `Error`
 * whose `.message` is the *stringified* original error — `instanceof`
 * checks on the far side are useless (verified empirically against
 * wasmoon 1.16.0: `new MyError('x')` thrown inside an injected async
 * function round-trips as `Error: MyError: x`, not `MyError`). So
 * classification of capability/marshal failures raised *from inside Lua
 * execution* is done by tagging the error message with one of the
 * `*_ERROR_TAG` prefixes below and pattern-matching on it in `sandbox.ts`
 * after the run fails. Resource-limit breaches are NOT classified this way
 * — they're tracked out-of-band via a plain JS closure flag set inside the
 * instruction hook (see `./limits`), which Lua code can never see or touch,
 * so that classification is exact regardless of what any error message says.
 */

/** Prefix tag for a capability (permission) denial raised into Lua from a host-provided function. */
export const CAPABILITY_ERROR_TAG = 'MARK_CAPABILITY';

/** Prefix tag for a marshal-time rejection raised from the in-Lua marshal walk (see `./marshal`). */
export const MARSHAL_ERROR_TAG = 'MARK_MARSHAL';

/** The limits a run can breach; see `./limits`. */
export type ScriptLimitKind = 'instructions' | 'timeout' | 'memory';

/** Why a return value was rejected by the marshaller; see `./marshal`. */
export type ScriptMarshalReason =
  'depth' | 'nodes' | 'cycle' | 'type' | 'key-type' | 'non-finite-number';

/**
 * The full discriminated failure shape `runScript` returns. `kind`:
 * - `'limit'` — a resource limit was breached (instruction count, wall
 *   clock, or memory). `limit` says which.
 * - `'capability'` — the script attempted something its granted
 *   capabilities don't allow (ungranted host, effectful op under an
 *   auto-run tier, disallowed bundle path/write).
 * - `'marshal'` — the script's return value could not be safely converted
 *   to a JSON-serializable JS value (function/userdata/thread, a cycle,
 *   too deep, too many nodes, a non-string table key, or a non-finite
 *   number). `reason` says which.
 * - `'runtime'` — an ordinary Lua error (syntax error, `error()` call,
 *   type error, stack overflow, etc.) not covered by the above.
 */
export interface ScriptFailure {
  kind: 'limit' | 'capability' | 'marshal' | 'runtime';
  message: string;
  limit?: ScriptLimitKind;
  reason?: ScriptMarshalReason;
}

/**
 * Thrown by the instruction-count/wall-clock hook installed in `./limits`
 * when this package needs to surface a limit breach as a JS-level
 * exception (e.g. from the outer `Promise.race` wall-clock guard in
 * `sandbox.ts`, for the async-hang case a Lua-level hook can't observe).
 * `runScript` always catches this itself — it is not part of the public
 * throwing surface, only an internal signal.
 */
export class ScriptLimitError extends Error {
  readonly limitKind: ScriptLimitKind;
  constructor(limitKind: ScriptLimitKind, message: string) {
    super(message);
    this.name = 'ScriptLimitError';
    this.limitKind = limitKind;
  }
}
