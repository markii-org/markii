// @markii/lua: the sandboxed Lua 5.4 (wasmoon) execution primitive backing
// spec §8 (scripting), §10 (capability security), and §11 (bundle-scoped
// filesystem). No React, no @markii/core, no @markii/react — see CLAUDE.md's
// import rule and the ESLint guard in the root config. May depend on
// @markii/bundle for the `ScriptView` capability type only.

export type {
  ScriptFailure,
  ScriptLimitKind,
  ScriptMarshalReason,
} from './errors';
export {
  CAPABILITY_ERROR_TAG,
  MARSHAL_ERROR_TAG,
  ScriptLimitError,
} from './errors';

export type { CreateEmptyLuaEngineOptions } from './globals';
export {
  ALLOWED_GLOBALS,
  DENIED_GLOBALS,
  createEmptyLuaEngine,
} from './globals';

export type { LimitHandle, ScriptLimits } from './limits';
export { DEFAULT_LIMITS, installLimits } from './limits';

export type {
  CacheEntry,
  CacheProvider,
  CapabilityConfig,
  CapabilityTier,
  NetGrants,
  NetProvider,
  NetResponse,
} from './capabilities';
export {
  DEFAULT_MAX_FETCH_BYTES,
  bytesToLuaString,
  buildCapabilities,
  luaStringToBytes,
} from './capabilities';

export type { MarshalLimits } from './marshal';
export {
  DEFAULT_MARSHAL_LIMITS,
  buildMarshalPrelude,
  finalizeMarshaledValue,
  wrapUserCode,
} from './marshal';

export { NOT_YET_SUPPORTED_MESSAGE, buildRequireStub } from './require';

export type { RunScriptOptions, RunScriptResult } from './sandbox';
export { runScript } from './sandbox';

export type { LuaExecutorConfig } from './executor';
export { createLuaExecutor } from './executor';
