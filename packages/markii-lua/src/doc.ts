import type { DocView } from '@markii/runtime';
import { buildJsonDecodePrelude } from './json-decode.js';
import {
  checkJsonWithinLimits,
  DEFAULT_MARSHAL_LIMITS,
  type MarshalLimits,
} from './marshal.js';

/**
 * The `doc` table (GitHub issue #33): a script's read-only view of the
 * note it is written in.
 *
 * `doc.directives(filter)` lists the note's directives in document order,
 * and `doc.value(name)` reads what a script ABOVE this one produced. Both
 * are pure reads of content the note already holds, so unlike `net`,
 * `cache` and `bundle` this table is NOT tier-gated and needs no grant: it
 * is wired identically for a manual run and an auto/scheduled one. There
 * is no write side to gate.
 *
 * ## Why the listing crosses as JSON text
 *
 * For the same reason `net.fetch_json` does (see `./json-decode`): a plain
 * JS object handed to `global.set` arrives in Lua as a wasmoon `js_proxy`
 * userdata, not a genuine table, so `type()`, `#`, `ipairs` and marshaling
 * a piece of it back out all misbehave. A string is a scalar and crosses
 * cleanly, and `__smd_json_decode` rebuilds it into an ordinary Lua table
 * the script cannot tell from one it wrote itself.
 *
 * The decode is repeated on every `doc.directives()` call rather than
 * cached in a Lua local, and that is deliberate: each call therefore hands
 * back FRESH tables. A script that scribbles on an entry it was given
 * cannot make the next call in the same script see its edits, and it never
 * had a way to reach the next script at all, since each script runs in its
 * own engine (`./sandbox`'s `runScript` builds and closes one per script).
 * The JSON itself is built once, on the JS side, and reused.
 *
 * ## What a rejected read looks like
 *
 * Reading a name that belongs to a script further down the note is a
 * script-authoring mistake, not a permission or resource problem. It is
 * therefore NOT recorded on `./capabilities`' `CapabilityDenials` handle:
 * recording it there would classify the run as `'capability-denied'` and
 * the host would tell the user their note needs a permission it does not
 * need. It stays a `'runtime'` failure, which `./executor` maps to
 * `'script-error'`, so the marker reads "script error: reads "quiz", which
 * runs later in the note".
 *
 * It does get its own out-of-band record ({@link DocRejections}), for the
 * same reason the capability denials have one: the message that comes back
 * OUT of Lua is wrapped ("Error: ..." plus a stack traceback) and may have
 * been rewritten by the script's own `pcall`/`error` games, so the host
 * would otherwise put a traceback in a tooltip. `./sandbox` reads the
 * recorded sentence instead, which the script can neither see nor forge.
 */
export interface DocConfig {
  /**
   * This script's view of its note, built by `@markii/runtime`'s
   * `runDocumentScripts` from the listing the host handed it. Absent, the
   * `doc` table is still wired, with an empty listing and a `value` that
   * answers nil for every name: a script must never meet a `doc` that is
   * nil, or the first thing an author writes fails as "attempt to index a
   * nil value" with nothing to explain it.
   */
  doc?: DocView;
  /**
   * The depth/node budget a value read through `doc.value` is checked
   * against before it is handed to Lua, exactly as `net.fetch_json` and
   * `cache.get` check theirs. A stored value has already passed this same
   * budget on its way OUT of the script that produced it, so this is a
   * second, defensive reading rather than the first one.
   */
  marshalLimits?: MarshalLimits;
}

/**
 * Non-spoofable record of the LAST `doc` read this run refused. A plain JS
 * closure, exactly like `./capabilities`' `CapabilityDenials`: no Lua
 * value, no metatable, nothing a script can read or write. `./sandbox`
 * consults it (after the capability handle, which outranks it) to report
 * the clean sentence rather than whatever came back through Lua.
 */
export interface DocRejections {
  last(): string | undefined;
}

/**
 * Builds the raw host functions and the trusted Lua prelude defining the
 * `doc` table. Shaped like `./capabilities`' `buildCapabilities` (raw flat
 * globals captured into prelude locals, then nil'd out) so the two follow
 * one pattern; see that function's doc comment for why the ergonomic
 * wrappers must be Lua-native tables rather than JS objects.
 */
export function buildDoc(config: DocConfig): {
  rawGlobals: Record<string, (...args: never[]) => Promise<unknown>>;
  preludeLua: string;
  rejections: DocRejections;
} {
  const view = config.doc;
  const limits: MarshalLimits = config.marshalLimits ?? DEFAULT_MARSHAL_LIMITS;

  let lastRejection: string | undefined;
  /** Records the clean sentence, THEN throws it — same order every denial site in `./capabilities` uses. */
  function reject(message: string): Error {
    lastRejection = message;
    return new Error(message);
  }

  let listingJson: string | undefined;
  const rawGlobals: Record<string, (...args: never[]) => Promise<unknown>> = {};

  rawGlobals.__smd_doc_listing_raw = (async () => {
    if (listingJson === undefined) {
      // The listing is already capped, sanitized plain data
      // (`@markii/runtime`'s `buildDirectiveListing`), so this cannot
      // throw on a cycle or a non-serializable member. The `?? '[]'` is
      // the belt for a host that supplied something stranger than a
      // listing: an empty list is always a truthful answer, an exception
      // never is.
      try {
        listingJson = JSON.stringify(view?.directives.directives ?? []) ?? '[]';
      } catch {
        listingJson = '[]';
      }
    }
    return listingJson;
  }) as (...args: never[]) => Promise<unknown>;

  rawGlobals.__smd_doc_value_raw = (async (name: string) => {
    if (!view) return undefined;
    const read = view.value(typeof name === 'string' ? name : '');
    if (!read.ok) {
      // `@markii/runtime` owns this sentence; this module only carries it.
      throw reject(read.message);
    }
    const value = read.value;
    if (value === undefined || value === null) return undefined;
    const budget = checkJsonWithinLimits(value, limits);
    if (!budget.ok) {
      throw reject(`doc.value("${name}") ${budget.message}`);
    }
    try {
      const encoded = JSON.stringify(value);
      return encoded === undefined ? undefined : encoded;
    } catch {
      throw reject(`doc.value("${name}") could not be read as a value`);
    }
  }) as (...args: never[]) => Promise<unknown>;

  const truncated = view?.directives.truncated === true;

  // `buildJsonDecodePrelude` is emitted here rather than assumed: this
  // module is exercised standalone in its own tests, and `./capabilities`
  // only emits it when `net`/`cache` are wired. Emitting it twice in one
  // run simply redefines the same idempotent trusted function, which is
  // the same reasoning `./capabilities`' own `ensureMarshalPrelude` uses.
  //
  // It defines `__smd_json_decode` as a GLOBAL, though, and `doc` is wired
  // for every run, so emitting it unconditionally would leave that private
  // name reachable from user code in runs that never wire `net`/`cache` --
  // exactly the residue `require-pass3.probe.test.ts` fails the suite for.
  // So the previous value is saved before and put back after: this module
  // pins its own copy in a local and leaves the globals table exactly as
  // it found it. Every other consumer pins its own copy at ITS prelude
  // time too (`./capabilities`), so restoring a nil here can never take a
  // decoder away from anyone.
  const preludeLua = `local __smd_doc_prev_decode = __smd_json_decode
${buildJsonDecodePrelude(limits)}
local __smd_doc_listing = __smd_doc_listing_raw
local __smd_doc_value = __smd_doc_value_raw
-- Every primitive this table needs is pinned HERE, at prelude-definition
-- time, never resolved as a global inside the wrappers -- the same
-- discipline \`./json-decode\` and \`./capabilities\` follow (adversarial
-- findings A1/A2). Without it, a script could rebind \`__smd_json_decode\`
-- or \`type\` before calling \`doc.directives\` and change what its own
-- guards do.
local __smd_doc_decode = __smd_json_decode
local __smd_doc_type, __smd_doc_error = type, error
__smd_json_decode = __smd_doc_prev_decode
__smd_doc_listing_raw = nil
__smd_doc_value_raw = nil

doc = {}
doc.truncated = ${truncated ? 'true' : 'false'}

doc.directives = function(filter)
  local wanted = nil
  if filter ~= nil then
    if __smd_doc_type(filter) ~= "table" then
      __smd_doc_error("doc.directives(filter): filter must be a table")
    end
    wanted = filter.name
    if wanted ~= nil and __smd_doc_type(wanted) ~= "string" then
      __smd_doc_error("doc.directives(filter): filter.name must be a string")
    end
  end
  local entries = __smd_doc_decode(__smd_doc_listing():await())
  if wanted == nil then return entries end
  local out = {}
  local n = 0
  for i = 1, #entries do
    local entry = entries[i]
    if entry.name == wanted then
      n = n + 1
      out[n] = entry
    end
  end
  return out
end

doc.value = function(name)
  if __smd_doc_type(name) ~= "string" then
    __smd_doc_error("doc.value(name): name must be a string")
  end
  local text = __smd_doc_value(name):await()
  if text == nil then return nil end
  return __smd_doc_decode(text)
end
`;

  return { rawGlobals, preludeLua, rejections: { last: () => lastRejection } };
}
