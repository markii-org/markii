import type {
  ExecuteResult,
  FailureKind,
  ScriptExecutor,
} from '@markii/runtime';
import { runScript, type RunScriptOptions } from './sandbox.js';
import type { ScriptFailure } from './errors.js';

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
 * Maps this package's own `ScriptFailure.kind` (`'limit' | 'capability' |
 * 'marshal' | 'runtime'`, further discriminated by `ScriptFailure.
 * capability` for the `'capability'` case) down to `@markii/runtime`'s
 * closed, shared `FailureKind` union (`'script-error' | 'capability-denied'
 * | 'tier-blocked' | 'limit'`):
 * - `'limit'`                                 -> `'limit'`
 * - `'capability'` with `capability === 'tier-blocked'` -> `'tier-blocked'`
 * - `'capability'` otherwise (i.e. `'denied'`, or — defensively — absent)
 *                                              -> `'capability-denied'`
 * - `'marshal'` / `'runtime'`                 -> `'script-error'`
 *
 * This is the one place the Lua-specific taxonomy and the runtime-shared
 * one meet; every other module in this package only knows `ScriptFailure`.
 */
function toRuntimeFailureKind(failure: ScriptFailure): FailureKind {
  switch (failure.kind) {
    case 'limit':
      return 'limit';
    case 'capability':
      return failure.capability === 'tier-blocked'
        ? 'tier-blocked'
        : 'capability-denied';
    case 'marshal':
    case 'runtime':
      return 'script-error';
  }
}

/**
 * Builds a `ScriptExecutor` (`@markii/runtime`) backed by this package's
 * `runScript`. `config` is captured once and reused for every script the
 * returned executor runs; the returned function's only per-call inputs are
 * `code` and `tier`, matching `ScriptExecutor`'s provider-agnostic
 * signature. `runScript` never throws (see `./sandbox`'s doc comment), so
 * this adapter doesn't need its own try/catch — it only reshapes the
 * result: `ok: true` passes `value` through untouched; `ok: false` maps
 * `runScript`'s `ScriptFailure` (`{ kind, message, ... }`) down to
 * `@markii/runtime`'s closed `ExecuteFailure` shape via
 * `toRuntimeFailureKind`, dropping the Lua-specific `limit`/`reason`/
 * `capability` sub-fields (still visible in `message` for anyone reading
 * the stored error).
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
      error: {
        kind: toRuntimeFailureKind(result.error),
        message: result.error.message,
      },
    };
  };
}
