import type { ScriptView } from '@markii/bundle';
import { bytesToLuaString } from './capabilities.js';
import { CAPABILITY_ERROR_TAG } from './errors.js';

/**
 * Sandboxed `require` (spec §8 "Long scripts and shared code", docs/
 * scripting.md): exactly two of the spec's three sources are implemented
 * here — bundle-local modules and the SEAM for pack modules (the pack
 * loader itself, and the third source, the vault library, are later
 * phases: packs need the pack-installation machinery from packs.md, and
 * the vault library needs a host-side namespace-to-folder mapping neither
 * of which exists yet). Both implemented sources, and the not-yet-wired
 * one, share ONE property: every require target this module resolves is
 * PURE LUA SOURCE TEXT, loaded as a fresh PROTECTED CHUNK on the SAME
 * thread as the rest of the run, so it shares that run's globals,
 * capabilities, and instruction/wall-clock/memory budget — a module can
 * never grant itself more than the script that required it already had.
 *
 * ## Two sources, told apart by the first path segment (docs/scripting.md)
 *
 * - **Bundle-local**: `require "scripts/util"`. The bundle's structural
 *   directories — `scripts`, `assets`, `.cache` — are reserved: a name
 *   whose first `/`-separated segment is exactly one of those three
 *   ALWAYS resolves inside the bundle. The module's source is fetched via
 *   the SAME `ScriptView` `bundle.read` uses (`./capabilities`), so it is
 *   subject to the exact same path-jail (`@markii/bundle`'s
 *   `normalizeBundlePath`, enforced inside `ScriptView`/`BundleStorage` —
 *   never re-implemented here) and the exact same read-permission check.
 *   Reading is the ONLY operation `require` ever performs — it never
 *   writes — so it is automatically read-only under every tier; there is
 *   no separate tier gate to apply on top of what `bundle.read` already
 *   enforces.
 * - **Pack-namespaced**: `require "ana/http"` (first segment anything
 *   else). This phase implements ONLY the seam: an optional injected
 *   `PackModuleResolver`. With no resolver configured (packs are not
 *   wired into any host yet), a pack-namespaced `require` fails cleanly
 *   as a capability denial — never a crash, never a fallthrough into
 *   filesystem or network access.
 *
 * ## Why a real `require` needs `load` back, carefully
 *
 * `./globals` removes `load` (and its bytecode-execution siblings) from
 * every sandbox by never letting a script reach a way to compile new
 * source at runtime — "the ONLY code that ever runs is the one chunk the
 * host handed in" (spec §10). A real `require` necessarily breaks that
 * absolute reading: the host is now explicitly choosing to run a SECOND
 * chunk, one whose text came from a bundle or a pack, not from the note's
 * own script block. This module does not reopen `load` as a general
 * capability — no script can ever call `load` directly, under any name.
 * Instead, `./globals` captures the genuine `load` primitive into a
 * private global (`__smd_load_raw`) an instant before scrubbing the
 * public name, and this module's own prelude is the ONLY consumer: it
 * captures that global into a local and immediately nils the global back
 * out, so it is reachable from nowhere else, for the rest of the run,
 * under any name a script could type. Every call this prelude makes to
 * it passes `mode = "t"` — Lua's own built-in "text chunks only" gate,
 * which makes `load` itself refuse anything starting with the Lua
 * bytecode signature (`\27Lua`) before compiling a single byte of it.
 * `buildRequire` below ALSO rejects that same signature on the JS side,
 * before the text ever reaches Lua at all — belt and suspenders, not
 * because either check alone is known to be insufficient, but because
 * this codebase's convention throughout (`captureAssertOkStatus`,
 * `ScriptLimitError`, the `xpcall` reimplementation) is to make a
 * security property hold for two independent reasons wherever the cost
 * of the second one is low.
 *
 * ## Cache, cycle detection, and protected execution — done entirely in Lua
 *
 * The module-name -> source-text lookup is the only part that needs a
 * host round trip (bundle-local: an async `ScriptView.read`; pack:
 * synchronous, but still crosses the JS/Lua boundary the same way).
 * Everything after that — the per-run cache, in-progress-stack cycle
 * detection, compiling, and running the module body — is plain Lua
 * control flow inside the prelude this module builds, calling Lua from
 * Lua, never JS calling into Lua. This deliberately mirrors
 * `./capabilities`' `cache.get`: a Lua function invoked FROM JS goes
 * through wasmoon's synchronous, non-yieldable bridge, so if a module
 * body itself calls `net.fetch_json` (which needs `:await()`), that call
 * must happen as an ordinary Lua-to-Lua call, never as a host-driven one.
 * The module body runs via `pcall(chunk)`, not `xpcall` — see
 * `./globals`' `XPCALL_REIMPLEMENTATION` doc comment for why the STOCK C
 * `xpcall` (which this sandbox never restores) can deadlock the host
 * under the limits hook; plain `pcall` has no such hazard, and a limit
 * breach during a module's execution still wins unconditionally via
 * `./limits`' out-of-band JS flag regardless of what any Lua-level
 * `pcall` around it reports.
 */

/** A pack-namespaced `require "packName/modulePath"` resolver, injected by a host that has actually wired up pack installation. Returns pure Lua SOURCE TEXT, or `undefined` if this pack/module isn't available — never throws for a routine "not found". */
export type PackModuleResolver = (
  packName: string,
  modulePath: string,
) => string | undefined;

export interface RequireConfig {
  /** The SAME `ScriptView` `./capabilities` wires up for `bundle.read`/`bundle.write` — reused, never re-implemented, so bundle-local `require` is subject to the identical path-jail and read-permission check. */
  bundle?: ScriptView;
  /** Optional pack-module seam — see the module doc comment. Absent (the current default: no host wires packs yet) means every pack-namespaced `require` fails as a clean capability denial. */
  packModuleResolver?: PackModuleResolver;
  /**
   * Records a genuine denial onto the SAME per-run `CapabilityDenials`
   * handle `./capabilities`' `buildCapabilities` already returns (its
   * `recordDenial` field) — so `sandbox.ts` classifies a require-triggered
   * denial as `kind: 'capability'`, exactly like any other capability
   * failure, rather than an unclassified `'runtime'` error. Optional only
   * so this module stays independently testable/usable without the rest
   * of `./capabilities`' wiring; `sandbox.ts` always supplies it.
   */
  recordDenial?: (reason: 'denied' | 'tier-blocked', message: string) => void;
}

/** The bundle's reserved structural directories (docs/scripting.md): a `require` name whose first `/`-segment is exactly one of these always resolves inside the bundle and can never be a pack namespace. */
const RESERVED_BUNDLE_DIRS: ReadonlySet<string> = new Set([
  'scripts',
  'assets',
  '.cache',
]);

/** First `/`-separated path segment of `name` (the whole string if there is no `/`). */
function firstSegment(name: string): string {
  const idx = name.indexOf('/');
  return idx === -1 ? name : name.slice(0, idx);
}

/** True iff `name`'s first segment is one of the bundle's reserved structural directories. */
function isBundleLocalName(name: string): boolean {
  return RESERVED_BUNDLE_DIRS.has(firstSegment(name));
}

/**
 * Maps a bundle-local `require` name to the bundle-relative path its
 * source is read from. A `.lua` suffix is appended when the name doesn't
 * already carry one — `require "scripts/util"` and `require
 * "scripts/util.lua"` both resolve to `scripts/util.lua`. This mapping is
 * this package's own convention (docs/scripting.md's `require` examples
 * never show an extension); it does not affect the path-jail, which is
 * enforced entirely by `ScriptView.read` on the resulting path regardless
 * of how it was built.
 */
function bundleModulePath(name: string): string {
  return name.endsWith('.lua') ? name : `${name}.lua`;
}

/** First byte of Lua's bytecode chunk signature (`"\27Lua..."`, i.e. ESC followed by `Lua`). */
const LUA_BYTECODE_SIGNATURE_FIRST_BYTE = 0x1b;

/**
 * Defense-in-depth bytecode rejection on the JS side, BEFORE a resolved
 * module's source ever reaches Lua's own `load(text, name, "t")` call
 * (which independently refuses the same signature — see the module doc
 * comment's "belt and suspenders" note). `source` here is always a JS
 * string built the same one-code-unit-per-byte way `./capabilities`'
 * `bytesToLuaString` produces, so `charCodeAt(0)` reads the first raw
 * byte, not a decoded Unicode code point.
 */
function looksLikeBytecode(source: string): boolean {
  return (
    source.length > 0 &&
    source.charCodeAt(0) === LUA_BYTECODE_SIGNATURE_FIRST_BYTE
  );
}

/**
 * Builds the raw host-facing module resolver and the trusted Lua prelude
 * that turns it into the real `require` global — see the module doc
 * comment for the full design. Always defines `require`, regardless of
 * whether `config.bundle` or `config.packModuleResolver` is present, so a
 * run with neither configured still gets a real, always-defined function
 * that fails every request cleanly (a capability denial), matching this
 * sandbox's "never a bare 'attempt to call a nil value'" posture for
 * every other documented host API surface.
 */
export function buildRequire(config: RequireConfig): {
  rawGlobals: Record<string, (...args: never[]) => Promise<unknown>>;
  preludeLua: string;
} {
  const recordDenial = config.recordDenial ?? ((): void => undefined);

  function denyAndThrow(message: string): never {
    recordDenial('denied', message);
    throw new Error(`${CAPABILITY_ERROR_TAG}: ${message}`);
  }

  const rawGlobals: Record<string, (...args: never[]) => Promise<unknown>> = {};

  rawGlobals.__smd_require_resolve_raw = (async (
    name: string,
  ): Promise<string> => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('require: module name must be a non-empty string');
    }

    let source: string;
    if (isBundleLocalName(name)) {
      const view = config.bundle;
      if (!view) {
        denyAndThrow(
          `bundle capability is not available for this run (require "${name}")`,
        );
      }
      const path = bundleModulePath(name);
      let data: Uint8Array | undefined;
      try {
        data = await view.read(path);
      } catch (err) {
        denyAndThrow(err instanceof Error ? err.message : String(err));
      }
      if (data === undefined) {
        // A genuine "no such module" — not a permission problem, so NOT
        // recorded as a denial. Spec: "a require that can't resolve fails
        // softly" — this propagates as an ordinary, uncaught Lua error
        // (see the prelude below), the same graceful failure shape any
        // other script-error already gets.
        throw new Error(`require: no bundle module at "${path}"`);
      }
      source = bytesToLuaString(data);
    } else {
      const resolver = config.packModuleResolver;
      if (!resolver) {
        denyAndThrow(
          `pack modules are not supported in this run (require "${name}")`,
        );
      }
      const segIdx = name.indexOf('/');
      const packName = segIdx === -1 ? name : name.slice(0, segIdx);
      const modulePath = segIdx === -1 ? '' : name.slice(segIdx + 1);
      const resolved = resolver(packName, modulePath);
      if (resolved === undefined) {
        throw new Error(
          `require: no pack module "${modulePath}" in pack "${packName}"`,
        );
      }
      source = resolved;
    }

    if (looksLikeBytecode(source)) {
      denyAndThrow(
        `require "${name}" resolved to a precompiled/binary chunk, which is never permitted (pure Lua source only)`,
      );
    }

    return source;
  }) as (...args: never[]) => Promise<unknown>;

  const preludeLua = `
-- Captured into locals HERE, at prelude-definition time, and the backing
-- globals nil'd out immediately after -- same discipline as every other
-- capability wrapper in ./capabilities (see its "Captured into a local
-- HERE" comments), and load-bearing for __smd_require_load specifically:
-- __smd_load_raw is the genuine Lua \`load\` primitive (./globals), and
-- leaving it reachable under any name for even one later statement would
-- reopen the exact "compile and run arbitrary text" hole §10 closes.
local __smd_require_resolve = __smd_require_resolve_raw
local __smd_require_load = __smd_load_raw
__smd_require_resolve_raw = nil
__smd_load_raw = nil

-- Per-run module cache and in-progress stack. Both are plain Lua locals
-- declared in THIS prelude chunk, which runs exactly once per fresh
-- engine (one runScript call) -- see the module doc comment. A fresh run
-- gets a fresh engine (./sandbox tears the whole engine down every call),
-- so neither table is ever visible to, or seeded by, a prior run.
local __smd_require_cache = {}
local __smd_require_stack = {}

require = function(name)
  if type(name) ~= "string" then
    error("require: module name must be a string")
  end
  local cached = __smd_require_cache[name]
  if cached ~= nil then
    return cached
  end
  if __smd_require_stack[name] then
    error("require: circular require of module '" .. name .. "'")
  end

  -- Resolution (bundle read or pack lookup) happens BEFORE the
  -- in-progress stack is touched, so a resolution failure (an ungranted
  -- bundle, a path-jail rejection, no pack resolver, a genuinely missing
  -- module) never leaves a stale stack entry behind to clean up.
  local text = __smd_require_resolve(name):await()

  __smd_require_stack[name] = true
  -- mode = "t": text chunks only -- Lua itself refuses to compile
  -- anything starting with the bytecode signature under this mode (see
  -- the module doc comment's "belt and suspenders" note; buildRequire
  -- already rejected it once, on the JS side, before this point).
  local chunk, loadErr = __smd_require_load(text, "=" .. name, "t")
  if not chunk then
    __smd_require_stack[name] = nil
    error("require: module '" .. name .. "' failed to compile: " .. tostring(loadErr))
  end

  -- Protected chunk: same thread, same globals/capabilities, same
  -- instruction/wall-clock/memory budget as the rest of this run (see
  -- ./limits -- the hook is installed on the thread, not per-chunk). A
  -- limit breach during this call still forces the WHOLE run to a hard
  -- failure via ./limits' out-of-band JS flag, regardless of what this
  -- pcall reports -- see the module doc comment on why plain pcall (never
  -- xpcall) is safe here.
  local ok, result = pcall(chunk)
  __smd_require_stack[name] = nil
  if not ok then
    error(result)
  end

  -- Matches stock Lua's own require: a module that returns nothing caches
  -- (and returns) \`true\` rather than \`nil\`, so a later \`require\` of the
  -- same name is unambiguously a cache HIT (nil is never a valid cached
  -- value, so it can never be mistaken for "not yet required").
  if result == nil then
    result = true
  end
  __smd_require_cache[name] = result
  return result
end
`;

  return { rawGlobals, preludeLua };
}
