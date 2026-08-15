/**
 * Sandboxed `require` (spec §8 "Script placement, long scripts, and
 * modules"): the eventual design is exactly two sources — bundle-local
 * modules (`require "scripts/util"`, same path-jail as `bundle.read`) and
 * pack-namespaced pure-Lua modules (`require "ana/http"`) — pure Lua
 * source only, no C, no bytecode, no network, module cache per run.
 *
 * DESIGN NOTE / explicit deferral: this phase (the sandbox primitive
 * itself) does not wire that up yet. `bundle.read` (via the injected
 * `ScriptView`, see `./capabilities`) already gives a script everything it
 * needs to fetch a bundle-local module's SOURCE TEXT; what a real
 * `require` adds on top is caching per module name and running the loaded
 * source as a new protected chunk with the same globals/capabilities —
 * both of those depend on the pack/namespace resolution rules (§8) that
 * belong to a later phase (packs, §5/§12), not to this security primitive.
 * Rather than build a real (but pack-less, cache-less) `require` now and
 * having to change its resolution semantics later, `require` is left
 * UNDEFINED — not stubbed as an always-erroring global — in this phase.
 *
 * Concretely: `sandbox.ts` never calls anything from this module, and the
 * curated environment (`./globals`) never sets a `require` global at all.
 * `NOT_YET_SUPPORTED_MESSAGE` and `buildRequireStub` are kept here,
 * disconnected from the sandbox wiring, as the landing point for that
 * later phase — a future change only needs to call `buildRequireStub()`
 * (or replace it with the real resolver) from `sandbox.ts`'s prelude
 * assembly, next to `buildCapabilities`.
 *
 * Either way — absent entirely (current state) or stubbed to always error
 * (the stub below, for a host that wants a friendlier error message than
 * a bare "attempt to call a nil value") — the guarantee the adversarial
 * suite checks holds: no raw Lua `require` is ever reachable, and no
 * script can load arbitrary source or bytecode through it.
 */
export const NOT_YET_SUPPORTED_MESSAGE =
  'modules not yet supported (require "%s")';

/**
 * Not wired into `sandbox.ts` in this phase (see module doc comment
 * above) — provided so a host that wants an explicit, friendlier error
 * message instead of Lua's default "attempt to call a nil value (global
 * 'require')" can opt in without this package needing to change shape
 * later. Deliberately does not touch the filesystem, network, or `load` —
 * it only ever raises.
 */
export function buildRequireStub(): string {
  return `
require = function(name)
  error(string.format(${JSON.stringify(NOT_YET_SUPPORTED_MESSAGE)}, tostring(name)))
end
`;
}
