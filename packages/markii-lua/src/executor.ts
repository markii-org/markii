import type { ExecuteResult, ScriptExecutor } from '@markii/runtime';
import { runScript, type RunScriptOptions } from './sandbox.js';

/**
 * Slice 2 of the scripting-usability layer (DESIGN.md §8): the reusable
 * adapter from this package's `runScript` to `@markii/runtime`'s
 * language-agnostic `ScriptExecutor` shape, so `runDocumentScripts` can run
 * a document's script blocks through the real Lua sandbox without
 * `@markii/runtime` ever depending on `@markii/lua`, wasmoon, or any
 * particular language runtime.
 *
 * Dependency direction: `@markii/lua -> @markii/runtime` (this file), TYPE
 * ONLY (`ScriptExecutor`/`ExecuteResult` are `import type`, so nothing from
 * `@markii/runtime` is bundled or evaluated at runtime by this package).
 * `@markii/runtime` never imports `@markii/lua` — see `run.ts` there,
 * which only knows about the `ScriptExecutor` function shape. There is no
 * cycle.
 */

/**
 * Everything `runScript` accepts except `code`/`tier` — those two are
 * supplied per call by `runDocumentScripts` (`@markii/runtime`); everything
 * else (net/netGrants/cache/bundle/maxFetchBytes/limits/marshalLimits) is
 * this note's fixed capability/resource configuration, closed over once at
 * executor-construction time.
 */
export type LuaExecutorConfig = Omit<RunScriptOptions, 'code' | 'tier'>;

/**
 * Builds a `ScriptExecutor` (`@markii/runtime`) backed by this package's
 * `runScript`. `config` is captured once and reused for every script the
 * returned executor runs; the returned function's only per-call inputs are
 * `code` and `tier`, matching `ScriptExecutor`'s provider-agnostic
 * signature. `runScript` never throws (see `./sandbox`'s doc comment), so
 * this adapter doesn't need its own try/catch — it only reshapes the
 * result: `ok: true` passes `value` through untouched; `ok: false` maps
 * `runScript`'s `ScriptFailure` (`{ kind, message, ... }`) down to the
 * narrower `{ kind: string; message: string }` `ExecuteFailure` shape
 * `@markii/runtime` expects, dropping the Lua-specific `limit`/`reason`
 * fields (still visible in `message` for anyone reading the stored error).
 */
export function createLuaExecutor(
  config: LuaExecutorConfig = {},
): ScriptExecutor {
  return async ({ code, tier }): Promise<ExecuteResult> => {
    const result = await runScript({ ...config, code, tier });
    if (result.ok) {
      return { ok: true, value: result.value };
    }
    return {
      ok: false,
      error: { kind: result.error.kind, message: result.error.message },
    };
  };
}
