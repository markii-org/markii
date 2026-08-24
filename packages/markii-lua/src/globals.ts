import { LuaFactory, LuaLibraries, type LuaEngine } from 'wasmoon';

/**
 * Builds the *empty* Lua environment (spec §10: "Scripts run in an empty
 * Lua environment: no `os`, no `io`, no `require`, no globals except the
 * capability functions the host injects").
 *
 * Strategy: `openStandardLibs: false` means wasmoon never calls
 * `luaL_openlibs` at all — `os`, `io`, `package`, `debug`, and `coroutine`
 * are never linked into this Lua state's globals table in the first place.
 * This is strictly stronger than "load everything, then delete the bad
 * parts": there is nothing to delete because the C library that would have
 * installed them was never invoked, so there is no back door (metatable,
 * `_ENV`, or otherwise) that recovers them — recovering a name that was
 * never assigned into the (single, shared) globals table is not possible in
 * Lua regardless of what handle a script obtains on that table.
 *
 * We then hand-load exactly four libraries via `Global.loadLibrary` (the
 * per-library `luaopen_*` wasmoon exposes) and immediately run a trusted
 * "scrub" prelude that nils out the specific names, within those four
 * libraries, that are still dangerous. Every inclusion/exclusion below is
 * commented with why.
 */

/**
 * Libraries linked into the sandbox, and why:
 * - Base (`_G`)  — required: this is where `pcall`/`xpcall`/`error`/
 *   `assert`/`type`/`tostring`/`tonumber`/`pairs`/`ipairs`/`next`/`select`
 *   live in stock Lua 5.4. There's no way to get these without opening
 *   Base, so Base is opened and then aggressively pruned (see below) —
 *   everything Base brings that ISN'T on the whitelist gets nil'd out by
 *   the scrub prelude.
 * - String  — string manipulation is core to "fetch JSON, format a label"
 *   scripts; pruned of `string.dump` only (see SCRUB_PRELUDE).
 * - Table   — `table.insert/remove/concat/sort/pack/unpack/move`: no
 *   member of this library reads/writes anything outside the table passed
 *   to it, so the whole library is safe as-is; nothing pruned.
 * - Math    — pure numeric functions (including `math.random`/
 *   `math.randomseed` — a script influencing its own PRNG seed cannot
 *   reach anything outside its own arithmetic); nothing pruned.
 *
 * NOT linked, and why (spec §10 threat model: the script is hostile):
 * - Coroutine — `coroutine.*` would let a script create additional Lua
 *   threads it controls directly. We already run the whole script on a
 *   dedicated child thread and drive `resume`/`yield` ourselves (for the
 *   capability await bridge, `./capabilities`, and the instruction-count
 *   hook, `./limits`); handing the script its own `coroutine.create` is
 *   unnecessary for the documented host API and only adds surface area
 *   (e.g. spawning coroutines to dodge the hook's per-thread installation
 *   — see the `./limits` doc comment on why hooks are per-thread).
 * - IO, OS   — filesystem/process/env/clock access. The bundle-scoped
 *   filesystem (§11) is the ONLY filesystem a script gets, via the
 *   injected `bundle.*` capability table (`./capabilities`), never real
 *   `io`.
 * - Package  — `package.loadlib`/`package.cpath` is exactly "load a native
 *   C module", meaningless (and dangerous, if it somehow resolved) in a
 *   WASM sandbox with no real filesystem; `require` itself is intentionally
 *   not wired to it either (see `./require`).
 * - Debug    — `debug.getmetatable`/`debug.getupvalue`/`debug.sethook`
 *   are a complete metatable/upvalue/hook bypass of every other
 *   restriction in this file. Never loaded.
 * - UTF8     — not on the documented host API surface; omitted by default
 *   deny (a script working with byte strings and `string.*` covers the
 *   documented use cases). Add it if a real need shows up — it carries no
 *   special risk (pure string library), it just wasn't asked for.
 */
const LIBRARIES: readonly LuaLibraries[] = [
  LuaLibraries.Base,
  LuaLibraries.String,
  LuaLibraries.Table,
  LuaLibraries.Math,
];

/**
 * Runs once per fresh engine, before any capability table or user code is
 * injected. Mutates the real `string` table object in place (`string.dump
 * = nil`) rather than replacing the `string` global — the metatable that
 * makes `("x"):upper()` work points at this same table object, so deleting
 * the field this way removes both `string.dump(...)` AND `("x"):dump()` in
 * one move, and can't be un-done by anything a script can reach (no
 * `getmetatable` is exposed — see below — so a script cannot even inspect,
 * let alone rewrite, that metatable).
 *
 * Base-library names removed, each independently a documented sandbox
 * escape or ambient-authority primitive:
 * - `load`, `loadstring`, `loadfile`, `dofile` — compile/run arbitrary
 *   source or bytecode text at runtime; the entire point of §10 is that
 *   the ONLY code that ever runs is the one chunk the host handed in.
 *   `lua_load` also accepts precompiled bytecode with no source-text
 *   validation — bytecode is not sandboxed the way source is (it can
 *   encode out-of-range opcodes that crash or exploit the VM), which is
 *   also why `string.dump` (bytecode *production*) is removed below.
 *   The real `load` function object is captured into a private global,
 *   `__smd_load_raw`, ONE LINE ABOVE where the public `load` name is
 *   nil'd out (see `SCRUB_PRELUDE` below) — mirroring the "capture the
 *   genuine primitive into a local/global at definition time, before a
 *   later script can rebind or lose it" discipline already used
 *   throughout this sandbox (e.g. `./marshal`'s `error`/`type`/`pairs`
 *   capture, `./capabilities`' `__smd_json_decode` capture). `./require`
 *   consumes `__smd_load_raw` from its own prelude (run later, still
 *   before any untrusted script code) to compile a fetched module's
 *   SOURCE TEXT ONLY — always called with Lua's `mode = "t"`, which
 *   makes `load` itself refuse a binary/bytecode chunk — and then nils
 *   `__smd_load_raw` back out once captured into its own local, so the
 *   raw primitive is never reachable as a global either before or after
 *   `require` claims it. No other code in this sandbox may read
 *   `__smd_load_raw`; it is not part of the documented host API.
 * - `collectgarbage` — its `"count"` argument is a harmless memory query
 *   but other arguments (`"stop"`, `"generational"`, `"incremental"`) let
 *   a script retune the collector as a denial-of-service knob against the
 *   memory cap installed in `./sandbox`; removed wholesale rather than
 *   allow-listing a sub-mode we don't need.
 * - `rawget`, `rawset`, `rawequal`, `rawlen` — bypass `__index`/
 *   `__newindex`/`__eq`/`__len` metamethods. Nothing in this sandbox
 *   currently relies on metamethod interception for security (we don't
 *   proxy the capability tables — see `./capabilities`), but keeping raw
 *   accessors off by default costs the sandbox nothing and closes off
 *   that category of future bug entirely: default-deny.
 * - `getmetatable`, `setmetatable` — `getmetatable("")` is the standard
 *   way to reach the shared string metatable and, with `setmetatable`,
 *   rewrite it — potentially restoring a removed method or corrupting
 *   `__index` for every string literal for the rest of the run. Removing
 *   both closes this off completely (there is then no Lua-reachable way
 *   to obtain any metatable at all, since `debug.getmetatable` is also
 *   unavailable — `debug` is never loaded).
 * - `print`, `warn` — write to the process's real stdout/stderr. Not a
 *   sandbox-escape by itself, but not on the documented host API surface
 *   (scripts communicate by *returning a value*, per spec §8 — "Scripts
 *   return values; they never write into the document body") and a
 *   console/stderr channel is an unnecessary side channel; default-deny.
 * - `_G`, `_VERSION` — `_G` is merely the *name* Base binds to the real
 *   globals table for convenience; removing the name does not remove the
 *   table (every chunk's `_ENV` upvalue still refers to it — that's
 *   unavoidable in Lua and is exactly why every prune in this file is done
 *   by MUTATING the real table/globals rather than rebinding a name to
 *   something else). What matters is that the *table itself* never had
 *   `os`/`io`/`debug`/`package`/`load`/etc. as members to begin with, so
 *   reaching it via `_ENV` recovers nothing. `_VERSION` is a harmless
 *   info leak with no use on the documented API; removed for
 *   default-deny consistency.
 *
 * Explicitly KEPT from Base (each is on the DoD-mandated whitelist):
 * `tonumber`, `tostring`, `type`, `ipairs`, `pairs`, `next`, `select`,
 * `error`, `assert`, `pcall`, `xpcall`. NOTE: `xpcall` is kept in name only —
 * the C-level `xpcall` Base actually provides is REPLACED by a pure-Lua
 * reimplementation (`XPCALL_REIMPLEMENTATION` below, run as part of this
 * prelude) that closes a host-deadlock the C version has under this
 * sandbox's limits hook; see that constant's doc comment for the full
 * mechanism and empirical evidence.
 *
 * `unpack`/`table.unpack`: Lua 5.4 (this build, no 5.1-compat flag) never
 * defines a *global* `unpack` — only `table.unpack` exists in stock 5.4,
 * confirmed empirically (a fresh engine with Base+Table loaded has no
 * global `unpack`). We do not synthesize one; `table.unpack` is exposed as
 * part of the (fully kept) Table library and is the documented spelling.
 */
/**
 * Replaces the C-level \`xpcall\` with a pure-Lua reimplementation built on
 * \`pcall\`.
 *
 * ## Why: the C \`xpcall\` deadlocks the host under the limits hook
 *
 * \`./limits\`' instruction/wall-clock interrupt works by having the JS
 * count-hook call \`thread.lua.lua_error(...)\` — a longjmp — from inside the
 * hook. That is an ordinary Lua error, so \`pcall\` and \`xpcall\` both catch
 * it (this is exactly what makes the "script's own pcall can't swallow the
 * interrupt" guarantee in \`./limits\` need the out-of-band JS flag in the
 * first place). With \`pcall\` that is harmless: no user code runs in
 * response, the call just returns \`false, err\` and the JS-side breach flag
 * still forces the run to a hard failure. But the C \`xpcall\` INVOKES THE
 * USER'S MESSAGE HANDLER as part of unwinding, while the VM is still inside
 * the C-level xpcall error-handling frame. If that handler also runs long
 * enough for the hook to fire again (trivially true once the hook has
 * already tightened to \`count = 1\` after the first breach — see
 * \`./limits\`), the second \`lua_error\` longjmps AGAIN, nested inside the
 * xpcall error-handler's setjmp/Asyncify state, and wasmoon deadlocks:
 * \`thread.run()\` never resolves or rejects, the JS event loop is fully
 * blocked (not spinning — an idle wait), and nothing external, including an
 * unrelated \`setTimeout\`, ever fires again. Verified empirically against
 * wasmoon 1.16.0 in a disposable child-process harness (own OS-level SIGKILL
 * watchdog, run outside this repo's test suite so a still-hanging case could
 * never block CI): \`return xpcall(f, f)\` and three structural variants
 * (looping in a \`while\` around the xpcall call, wrapping the xpcall call in
 * an outer \`pcall\`, and a looping message handler with a non-looping body)
 * all hang the host process indefinitely under the stock C \`xpcall\`, while
 * \`pcall\`-only equivalents (including the pcall-wrapped-retry-loop "worst
 * case" documented in \`./limits\`) correctly terminate as limit failures.
 *
 * ## The fix
 *
 * Reimplementing \`xpcall\` in Lua on top of \`pcall\` means the message
 * handler runs at ORDINARY Lua call depth (an ordinary function call from
 * inside this prelude's own \`xpcall\`, itself invoked through \`pcall\`),
 * never inside the C xpcall error-unwind frame — so a hook-triggered
 * longjmp during the handler propagates exactly like it does for the
 * already-safe \`pcall\` cases, instead of deadlocking. Verified empirically
 * in the same disposable harness: with this reimplementation installed, all
 * four former-hang cases now terminate (well under a second) as
 * \`{ok:false, error:{kind:'limit', limit:'instructions'}}\`, and legitimate
 * \`xpcall(f, handler)\` usage (handler receiving the error object on
 * failure; all return values passed through unchanged on success) is
 * unaffected — see \`limits.deadlock.test.ts\`.
 *
 * ## Accepted semantics change (safe in this sandbox)
 *
 * The handler now runs AFTER the stack has unwound (an ordinary \`pcall\`
 * return), not WHILE it is still live, so it cannot walk a live traceback
 * the way \`debug.traceback\` would from inside a real C \`xpcall\` handler.
 * This loses nothing real here: \`debug\` is never loaded in this sandbox
 * (see the library table below), so no script could have used that
 * capability anyway. \`table.pack\`/\`table.unpack\` preserve variadic
 * arguments to \`f\` and every return value on the success path, matching
 * stock \`xpcall\`'s multi-return contract.
 */
const XPCALL_REIMPLEMENTATION = `
do
  local _pcall = pcall
  xpcall = function(f, msgh, ...)
    local r = table.pack(_pcall(f, ...))
    if r[1] then return table.unpack(r, 1, r.n) end
    return false, msgh(r[2])
  end
end
`;

const SCRUB_PRELUDE = `
__smd_load_raw = load
load = nil
loadstring = nil
loadfile = nil
dofile = nil
collectgarbage = nil
rawget = nil
rawset = nil
rawequal = nil
rawlen = nil
getmetatable = nil
setmetatable = nil
print = nil
warn = nil
_G = nil
_VERSION = nil
string.dump = nil
${XPCALL_REIMPLEMENTATION}
`;

/** The Base-library names this sandbox intentionally keeps reachable. */
export const ALLOWED_GLOBALS: readonly string[] = [
  'tonumber',
  'tostring',
  'type',
  'ipairs',
  'pairs',
  'next',
  'select',
  'error',
  'assert',
  'pcall',
  'xpcall',
  'string',
  'table',
  'math',
];

/** Names this sandbox verifies are absent after scrubbing (see the adversarial test suite). */
export const DENIED_GLOBALS: readonly string[] = [
  'os',
  'io',
  'require',
  'dofile',
  'loadfile',
  'load',
  'loadstring',
  'debug',
  'package',
  'coroutine',
  'collectgarbage',
  'rawget',
  'rawset',
  'rawequal',
  'rawlen',
  'getmetatable',
  'setmetatable',
  'print',
  'warn',
  '_G',
  '_VERSION',
];

export interface CreateEmptyLuaEngineOptions {
  /**
   * Forwarded verbatim as wasmoon's `LuaFactory` first constructor argument
   * (`customWasmUri` — confirmed against `node_modules/wasmoon/dist/
   * factory.d.ts`). Left `undefined` (the default), `LuaFactory` keeps its
   * own built-in resolution: the local `node_modules/wasmoon/dist/glue.wasm`
   * file in Node (used by this package's own Vitest suite), or — in a
   * browser bundle with no bundler-provided URL — a fetch to
   * `https://unpkg.com/wasmoon@<version>/dist/glue.wasm` at runtime
   * (confirmed in `node_modules/wasmoon/dist/index.js`). That CDN fetch is
   * exactly what makes an unconfigured browser host non-offline-capable: no
   * network to unpkg means no script can ever run. A host that wants to
   * avoid it (e.g. the playground, via a Vite `?url` asset import so the
   * wasm ships in its own bundle) passes its own local URL here instead.
   * Passing `undefined` is IDENTICAL to omitting this options object
   * entirely — this parameter only ever narrows behavior, never changes it
   * by default.
   */
  wasmUri?: string;
}

/**
 * Creates a fresh wasmoon engine with the curated, empty environment
 * described above. `traceAllocations: true` is required for the memory cap
 * (`./limits` / `./sandbox` call `engine.global.setMemoryMax`) — without it
 * wasmoon uses the plain, uncapped allocator.
 */
export async function createEmptyLuaEngine(
  options?: CreateEmptyLuaEngineOptions,
): Promise<LuaEngine> {
  const factory = new LuaFactory(options?.wasmUri);
  const engine = await factory.createEngine({
    openStandardLibs: false,
    traceAllocations: true,
  });
  for (const library of LIBRARIES) {
    engine.global.loadLibrary(library);
  }
  await engine.doString(SCRUB_PRELUDE);
  return engine;
}
