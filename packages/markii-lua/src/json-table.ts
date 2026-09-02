import { MARSHAL_ERROR_TAG } from './errors.js';
import { buildJsonDecodePrelude } from './json-decode.js';
import {
  checkJsonWithinLimits,
  finalizeMarshaledValue,
  type MarshalLimits,
} from './marshal.js';

export interface JsonTableConfig {
  /**
   * Depth/node budget applied to a `json.decode` input and, via
   * `__smd_marshal_root`, to a `json.encode` value. The SAME `MarshalLimits`
   * `./sandbox` already uses for the marshal prelude and `./capabilities`
   * uses for `net.fetch_json` -- never a second, independently-tuned cap.
   */
  limits: MarshalLimits;
  /**
   * Byte-size cap on the TEXT handed to `json.decode`, checked before the
   * text is JSON-parsed at all. The SAME cap `net.fetch_json` applies to a
   * fetched response body (`./capabilities`' `maxFetchBytes`), reused here
   * rather than forked.
   */
  maxFetchBytes: number;
}

/**
 * Builds the raw JS globals and trusted Lua prelude for the `json` table:
 * `json.decode(text)` and `json.encode(value)` (GitHub issue #40, slice 3a).
 *
 * `json` is pure computation with no I/O -- it never touches the network,
 * the bundle filesystem, or the clock -- so `./sandbox` injects this
 * unconditionally, for every tier, with no capability grant required. This
 * mirrors how `./marshal`'s and `./doc`'s preludes are already injected
 * unconditionally; `json` joins that same "always present" set rather than
 * being wired through `./capabilities`' tier/grant machinery, which exists
 * specifically to gate effectful or ambient-authority operations this
 * table has none of.
 *
 * ## `json.decode`: reuses the EXISTING decoder and EXISTING budget
 *
 * The actual parse is `./json-decode`'s `__smd_json_decode` -- the same
 * trusted, in-Lua JSON decoder `net.fetch_json`/`cache.get` already use in
 * `./capabilities` (see that module's doc comment for why decoding must
 * happen entirely in Lua rather than trusting wasmoon's own JS-object
 * conversion). This function never writes a second decoder.
 *
 * Before that decoder ever sees the text, a JS-side precheck applies the
 * exact same two-part budget `net.fetch_json` applies to a fetched body:
 * the `maxFetchBytes` byte-size cap (an ordinary, untagged `error()`,
 * `kind: 'runtime'` -- no `ScriptMarshalReason` value fits "too many
 * bytes"), and `./marshal`'s `checkJsonWithinLimits` (the very function
 * `./capabilities` calls) against the `JSON.parse`d value, tagged
 * `MARK_MARSHAL:depth`/`MARK_MARSHAL:nodes` so `./sandbox`'s
 * `classifyRuntimeError` reports it as `kind: 'marshal'`, `reason: 'depth'
 * | 'nodes'` -- the same classification a `json.encode` budget violation
 * gets (see below), so a script sees one consistent failure shape for "too
 * deep or too wide" regardless of which direction it happened. Text that
 * fails to `JSON.parse` at all is NOT diagnosed here in JS: it is
 * handed straight to `__smd_json_decode`, which raises its own "malformed"
 * error -- duplicating that diagnosis in two places risks the two
 * disagreeing, and the Lua decoder's message is the one already documented.
 *
 * ## `json.encode`: reuses the EXISTING marshal walk
 *
 * `json.encode(value)` runs `value` through `__smd_marshal_root`
 * (`./marshal`'s `buildMarshalPrelude`, already injected once per engine
 * before this prelude runs) -- the SAME depth/node-capped, cycle-detecting,
 * type-checking walk a script's own top-level return value already goes
 * through. No second walk is written. The capped, marker-tagged result then
 * crosses to JS as a single bounded function argument (safe by construction:
 * the walk has already capped it, exactly as `./capabilities`' `cache.get`
 * write path already relies on for the same reason), where
 * `finalizeMarshaledValue` -- the same JS-side pass `./sandbox` runs on a
 * script's return value -- strips the array marker and rejects a
 * non-finite number, before the result is `JSON.stringify`d. A cycle,
 * excess depth/nodes, a non-string table key, or a function/userdata/thread
 * all raise the walk's existing `MARK_MARSHAL:<reason>` tag, so `json.encode`
 * failures classify exactly like a script's own return-value marshal
 * failures: `kind: 'marshal'`, with `reason` one of `./marshal`'s existing
 * `ScriptMarshalReason` values.
 *
 * ## Rebinding safety
 *
 * `json.decode`/`json.encode` themselves close over `type`, `error`,
 * `__smd_json_decode`, and `__smd_marshal_root` captured into locals AT
 * PRELUDE-DEFINITION TIME -- before any untrusted script code runs -- so a
 * later script reassigning any of those globals (or `json` itself) cannot
 * neuter the type check or reach past the reused decoder/marshal walk. This
 * is the same discipline `./json-decode` (finding A1) and `./capabilities`
 * (findings A2/D1) already apply to their own internal calls into these
 * exact two functions.
 */
export function buildJsonTable(config: JsonTableConfig): {
  rawGlobals: Record<string, (...args: never[]) => Promise<unknown>>;
  preludeLua: string;
} {
  const { limits, maxFetchBytes } = config;
  const rawGlobals: Record<string, (...args: never[]) => Promise<unknown>> = {};

  rawGlobals.__smd_json_decode_precheck_raw = (async (text: string) => {
    if (typeof text === 'string' && text.length > maxFetchBytes) {
      // No `ScriptMarshalReason` value fits "too many bytes" (that taxonomy
      // is depth/nodes/cycle/type/key-type/non-finite-number/nul-byte, none
      // of which is a byte-size cap), so this is left untagged: an ordinary
      // Lua error, classified `kind: 'runtime'` by `./sandbox` like any
      // other `error()` call. It is still a clean, bounded, descriptive
      // failure -- never a hang, never a crash -- which is what matters.
      throw new Error(
        `json.decode: input exceeds the ${maxFetchBytes}-byte limit`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not valid JSON text: let `__smd_json_decode` (the Lua decoder)
      // raise its own "malformed" error rather than diagnosing this twice,
      // in two places, with two possibly-inconsistent messages.
      return true;
    }
    const check = checkJsonWithinLimits(parsed, limits);
    if (!check.ok) {
      throw new Error(
        `${MARSHAL_ERROR_TAG}:${check.reason}: json.decode input ${check.message}`,
      );
    }
    return true;
  }) as (...args: never[]) => Promise<unknown>;

  rawGlobals.__smd_json_encode_raw = (async (marshaledValue: unknown) => {
    const finalized = finalizeMarshaledValue(marshaledValue);
    if (!finalized.ok) {
      throw new Error(`${MARSHAL_ERROR_TAG}:${finalized.reason}`);
    }
    const text = JSON.stringify(finalized.value);
    // `JSON.stringify` only returns `undefined` for a value it cannot
    // represent -- already excluded by `finalizeMarshaledValue` above -- so
    // this is a defensive fallback that is never expected to trigger.
    return text === undefined ? 'null' : text;
  }) as (...args: never[]) => Promise<unknown>;

  const preludeLua = `
${buildJsonDecodePrelude(limits)}

-- Captured into locals HERE, at prelude-definition time -- see the module
-- doc comment's "Rebinding safety" section.
local __smd_json_type = type
local __smd_json_error = error
local __smd_json_decode_precheck = __smd_json_decode_precheck_raw
local __smd_json_encode_finish = __smd_json_encode_raw
local __smd_json_decode_fn = __smd_json_decode
local __smd_json_marshal_root = __smd_marshal_root
__smd_json_decode_precheck_raw = nil
__smd_json_encode_raw = nil
-- \`__smd_json_decode\` (defined by the injected \`./json-decode\` prelude
-- above) is only ever needed as a GLOBAL long enough for callers to capture
-- it into their own local -- exactly like \`__smd_net_get_json_decode\` and
-- \`__smd_cache_json_decode\` already do in \`./capabilities\`. This prelude
-- runs AFTER any of those (see \`./sandbox\`'s injection order), so every
-- earlier consumer has already captured its own reference by this point;
-- nilling the global here keeps \`json\` from being the run that leaves a
-- private \`__smd_\` name reachable on every single run (it is now injected
-- UNCONDITIONALLY, unlike \`net\`/\`cache\`, which only define this global
-- when actually configured) -- see the pass-3 residue probes
-- (\`require-pass3.probe.test.ts\`, \`doc.probe.test.ts\`), which assert NO
-- \`__smd_\`-prefixed global survives except \`__smd_marshal_root\`.
__smd_json_decode = nil

json = json or {}
json.decode = function(text)
  if __smd_json_type(text) ~= "string" then
    __smd_json_error("json.decode expects a string argument")
  end
  __smd_json_decode_precheck(text):await()
  return __smd_json_decode_fn(text)
end
json.encode = function(value)
  return __smd_json_encode_finish(__smd_json_marshal_root(value)):await()
end
`;

  return { rawGlobals, preludeLua };
}
