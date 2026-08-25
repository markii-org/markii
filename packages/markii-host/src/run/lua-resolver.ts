/**
 * The pure half of the Run path's `PackModuleResolver` (`@markii/lua`'s
 * `require.ts`): a synchronous, in-memory lookup over a pre-loaded map of
 * pack Lua source text. `vscode`-free and dependency-free beyond
 * `@markii/bundle`'s path jail, so it is unit-testable directly.
 *
 * WHY pre-loaded rather than reading files live: the resolver runs on the
 * `worker_thread` the Run path spawns per run (`run/worker-entry.ts`),
 * which has no filesystem access of its own — by design, the worker's only
 * inputs are the serializable `RunJob` message the extension host posts to
 * it (docs/security.md's isolate model treats the worker as running
 * untrusted script content). So the extension host reads every pack's
 * `scripts/*.lua` files ahead of time (`./pack-scripts.ts`), and this
 * module's map is exactly that pre-read content, structurally cloned into
 * the job. `require "packName/modulePath"` then resolves with no I/O at
 * all inside the worker.
 */
import { normalizeBundlePath } from '@markii/bundle';
import type { PackModuleResolver } from '@markii/lua';

/**
 * Pack namespace -> (bundle-jail-normalized module path, always ending in
 * `.lua`) -> Lua source text. Produced by `./pack-scripts.ts` on the
 * extension host and carried into the worker as `RunJob.packModules`.
 */
export type PackModulesMap = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

/**
 * Normalizes a `require "packName/modulePath"` module path the same way
 * `./pack-scripts.ts` normalized it while building the map: reject any
 * path-jail violation (`..`, an absolute path, a null byte, a backslash —
 * see `@markii/bundle`'s `normalizeBundlePath`) and append `.lua` when the
 * caller didn't already write one, matching `@markii/lua`'s own bundle-local
 * `require` convention. Returns `undefined` for anything the jail rejects —
 * never throws, so a hostile or malformed module path degrades to the same
 * "no such module" outcome an ordinary miss gets.
 */
function normalizeModulePath(modulePath: string): string | undefined {
  const withExtension = modulePath.endsWith('.lua')
    ? modulePath
    : `${modulePath}.lua`;
  const result = normalizeBundlePath(withExtension);
  return result.ok ? result.path : undefined;
}

/**
 * Builds a `PackModuleResolver` (`@markii/lua`) backed by a pre-loaded
 * `PackModulesMap`. Every lookup is read with `Object.hasOwn` only (never
 * bare indexing) so a pack namespace or module path shaped like
 * `__proto__`/`constructor` can never resolve through the prototype chain,
 * matching this codebase's hostile-map discipline throughout
 * `@markii/pack`/`@markii/bundle`.
 *
 * Returns `undefined` (a clean "no such module", per `PackModuleResolver`'s
 * own contract) for: an unconfigured pack namespace, a module path the
 * bundle-jail rejects (traversal, absolute path, null byte, backslash), or
 * a module path not present in the map. Never throws.
 */
export function createPackModuleResolver(
  modules: PackModulesMap,
): PackModuleResolver {
  return (packName, modulePath) => {
    if (!Object.hasOwn(modules, packName)) return undefined;
    const packModules = modules[packName];
    if (packModules == null) return undefined;

    const normalized = normalizeModulePath(modulePath);
    if (normalized === undefined) return undefined;

    if (!Object.hasOwn(packModules, normalized)) return undefined;
    return packModules[normalized];
  };
}
