// @markii/lua: the sandboxed Lua 5.4 (wasmoon) execution primitive backing
// spec §8 (scripting), §10 (capability security), and §11 (bundle-scoped
// filesystem). No React, no @markii/core, no @markii/react — see AGENTS.md's
// import rule and the ESLint guard in the root config. May depend on
// @markii/bundle for the `ScriptView` capability type only.
//
// This entry is the package's semver promise. The sandbox's assembly parts
// (the capability, document, require, marshalling and limit builders and the
// global lists) stay inside the package, so hardening the sandbox never
// changes a public name. `@markii/lua/internal` carries the one assembly
// part another workspace here builds on, with no semver promise.

export type {
  ScriptFailure,
  ScriptLimitKind,
  ScriptMarshalReason,
} from './errors.js';
export {
  CAPABILITY_ERROR_TAG,
  FETCH_DECODE_ERROR_TAG,
  MARSHAL_ERROR_TAG,
  ScriptLimitError,
} from './errors.js';

export type { CreateEmptyLuaEngineOptions } from './globals.js';
export {
  MISSING_WASM_URI_MESSAGE,
  MissingWasmUriError,
  createEmptyLuaEngine,
} from './globals.js';

export type { ScriptLimits } from './limits.js';
export { DEFAULT_LIMITS } from './limits.js';

export type {
  CacheEntry,
  CacheProvider,
  CapabilityTier,
  NetGrants,
  NetProvider,
  NetResponse,
} from './capabilities.js';
export {
  DEFAULT_MAX_FETCH_BYTES,
  isNetProviderDenial,
  netProviderDenial,
} from './capabilities.js';

export type { MarshalLimits } from './marshal.js';
export { DEFAULT_MARSHAL_LIMITS } from './marshal.js';

export type { PackModuleResolver } from './require.js';

export type { RunScriptOptions, RunScriptResult } from './sandbox.js';
export { runScript } from './sandbox.js';

export type { LuaExecutorConfig } from './executor.js';
export { createLuaExecutor } from './executor.js';
