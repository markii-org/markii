/**
 * End-to-end pin for "a pack module is the ONE way to share Lua beyond a
 * bundle's own `scripts/` folder" (AGENTS.md's locked decision): a pack
 * with `"components": {}` still contributes its `scripts/*.lua` through the
 * real `require` seam, resolved by the real wasmoon interpreter — not a
 * mock.
 *
 * This exercises the full chain a Run actually uses, minus only the
 * worker-thread transport (`./pack-scripts.ts` reads files on the "host"
 * side; `../run/lua-resolver.ts`'s `createPackModuleResolver` is the exact
 * synchronous lookup the worker calls; `@markii/lua`'s `buildRequire` +
 * `createEmptyLuaEngine` run the real interpreter):
 *
 *   pack.json (components: {}) + scripts/*.lua
 *     -> discoverPacks (@markii/pack's parsePackManifest)
 *     -> loadPackModules (./pack-scripts.ts)
 *     -> createPackModuleResolver (../run/lua-resolver.ts)
 *     -> buildRequire (@markii/lua) running on a real wasmoon engine
 */
import { describe, expect, it } from 'vitest';
import { createEmptyLuaEngine, buildRequire } from '@markii/lua';
import type { RequireConfig } from '@markii/lua';
import { discoverPacks } from './discover.js';
import type { PackFileReader } from './discover.js';
import { loadPackModules } from './pack-scripts.js';
import type { PackScriptsReader } from './pack-scripts.js';
import { createPackModuleResolver } from '../run/lua-resolver.js';

/** Runs `code` against a fresh, real engine with `require` wired via `buildRequire(config)` — same helper shape as `@markii/lua`'s own `require.test.ts`. */
async function run(
  code: string,
  config: RequireConfig,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const engine = await createEmptyLuaEngine();
  try {
    const { rawGlobals, preludeLua } = buildRequire(config);
    for (const [name, fn] of Object.entries(rawGlobals)) {
      engine.global.set(name, fn);
    }
    if (preludeLua.trim().length > 0) {
      await engine.doString(preludeLua);
    }
    const thread = engine.global.newThread();
    const idx = engine.global.getTop();
    try {
      thread.loadString(code);
      const result = await thread.run(0);
      return { ok: true, value: result.length > 0 ? result[0] : undefined };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      engine.global.remove(idx);
    }
  } finally {
    engine.global.close();
  }
}

describe('a module-only pack (components: {}) contributes shared Lua through require, end to end', () => {
  it('discovers the pack, loads its scripts/*.lua, and resolves require against the real interpreter', async () => {
    const folder = '/packs/vaultlua';
    const manifest = JSON.stringify({
      name: 'vaultlua',
      engine: 'react',
      components: {},
    });
    const discoverReader: PackFileReader = async (absolutePath) =>
      absolutePath === `${folder}/pack.json` ? manifest : undefined;

    const discovered = await discoverPacks([folder], discoverReader);
    expect(discovered.skipped).toEqual([]);
    expect(discovered.packs).toHaveLength(1);
    const pack = discovered.packs[0]!;
    expect(pack.componentPaths).toEqual({});

    const scriptsReader: PackScriptsReader = {
      async readDirectory(dir) {
        return dir === pack.scriptsDir
          ? [{ name: 'greet.lua', isDirectory: false }]
          : [];
      },
      async readFile(file) {
        return file === `${pack.scriptsDir}/greet.lua`
          ? 'return { hello = function(name) return "hi " .. name end }'
          : undefined;
      },
    };

    const modules = await loadPackModules([pack], scriptsReader);
    const resolver = createPackModuleResolver(modules);

    const result = await run(
      'local m = require("vaultlua/greet"); return m.hello("world")',
      { packModuleResolver: resolver },
    );

    expect(result).toEqual({ ok: true, value: 'hi world' });
  });

  it('a require for a module the pack does not have fails softly, never a crash', async () => {
    const folder = '/packs/vaultlua';
    const manifest = JSON.stringify({
      name: 'vaultlua',
      engine: 'react',
      components: {},
    });
    const discoverReader: PackFileReader = async (absolutePath) =>
      absolutePath === `${folder}/pack.json` ? manifest : undefined;

    const discovered = await discoverPacks([folder], discoverReader);
    const pack = discovered.packs[0]!;

    // No scripts/ directory at all — the "components-only-shaped pack with
    // nothing under scripts/" case, symmetric with a components-only pack
    // that has no shared Lua.
    const emptyScriptsReader: PackScriptsReader = {
      async readDirectory() {
        return [];
      },
      async readFile() {
        return undefined;
      },
    };

    const modules = await loadPackModules([pack], emptyScriptsReader);
    const resolver = createPackModuleResolver(modules);

    const result = await run('return require("vaultlua/missing")', {
      packModuleResolver: resolver,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/no pack module/);
    }
  });
});
