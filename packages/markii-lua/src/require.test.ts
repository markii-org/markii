import { zipSync } from 'fflate';
import {
  createScriptView,
  openZipBundle,
  type BundleManifest,
} from '@markii/bundle';
import { describe, expect, it } from 'vitest';
import { createEmptyLuaEngine } from './globals';
import { buildRequire, type RequireConfig } from './require';

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Runs `code` against a fresh engine with `require` wired via `buildRequire(config)` — unit-level, mirrors `capabilities.test.ts`'s own `run` helper. */
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

/** A bundle with a `scripts/` folder, granted full read access — the fixture most of these tests share. */
function fixtureBundle(scripts: Record<string, string>) {
  const files: Record<string, Uint8Array> = {
    'note.mk.md': u8('# hello'),
    'manifest.json': u8('{"mark":"0.1.0"}'),
  };
  for (const [name, source] of Object.entries(scripts)) {
    files[`scripts/${name}`] = u8(source);
  }
  const bytes = zipSync(files);
  const storage = openZipBundle(bytes);
  const manifest: BundleManifest = {
    mark: '0.1.0',
    permissions: { bundle: ['read'] },
  };
  const view = createScriptView(storage, manifest, { bundle: ['read'] });
  return view;
}

describe('buildRequire — always defines a real require, even with nothing configured', () => {
  it('is a function, never absent', async () => {
    const r = await run('return type(require)', {});
    expect(r).toEqual({ ok: true, value: 'function' });
  });

  it('requiring a bundle-local name with no bundle configured fails cleanly, not a crash', async () => {
    const r = await run('return require("scripts/util")', {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/bundle capability is not available/);
    }
  });

  it('requiring a pack-namespaced name with no resolver configured fails cleanly, not a crash', async () => {
    const r = await run('return require("ana/http")', {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/pack modules are not supported/);
    }
  });
});

describe('buildRequire — bundle-local modules', () => {
  it('resolves "scripts/util" to scripts/util.lua and runs it, returning its value', async () => {
    const view = fixtureBundle({ 'util.lua': 'return { greet = "hi" }' });
    const r = await run('local m = require("scripts/util"); return m.greet', {
      bundle: view,
    });
    expect(r).toEqual({ ok: true, value: 'hi' });
  });

  it('accepts an explicit ".lua" suffix in the require name too', async () => {
    const view = fixtureBundle({ 'util.lua': 'return 42' });
    const r = await run('return require("scripts/util.lua")', {
      bundle: view,
    });
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it('a module returning nothing caches (and returns) `true`, matching stock Lua require', async () => {
    const view = fixtureBundle({ 'noop.lua': '-- no return' });
    const r = await run('return require("scripts/noop")', { bundle: view });
    expect(r).toEqual({ ok: true, value: true });
  });

  it('a non-existent bundle module fails softly (ordinary error, not a capability denial)', async () => {
    const view = fixtureBundle({ 'util.lua': 'return 1' });
    const r = await run('return require("scripts/does-not-exist")', {
      bundle: view,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/no bundle module/);
      expect(r.message).not.toMatch(/MARK_CAPABILITY/);
    }
  });

  it('a bundle with no read grant denies require the same way it denies bundle.read', async () => {
    const bytes = zipSync({
      'note.mk.md': u8('# hello'),
      'manifest.json': u8('{"mark":"0.1.0"}'),
      'scripts/util.lua': u8('return 1'),
    });
    const storage = openZipBundle(bytes);
    const manifest: BundleManifest = {
      mark: '0.1.0',
      permissions: { bundle: ['read'] },
    };
    // Manifest declares read, but the user never granted it — DEFECT 10
    // intersection semantics (see @markii/bundle's createScriptView).
    const view = createScriptView(storage, manifest, { bundle: [] });
    const r = await run('return require("scripts/util")', { bundle: view });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('MARK_CAPABILITY');
  });
});

describe('buildRequire — reserved-directory routing', () => {
  it('"assets/..." and ".cache/..." also route as bundle-local (reserved dirs), not a pack namespace', async () => {
    const view = fixtureBundle({});
    const r1 = await run('return require("assets/x")', { bundle: view });
    const r2 = await run('return require(".cache/x")', { bundle: view });
    // Both fail (no such file), but as an ordinary "no bundle module"
    // error, never a "pack modules are not supported" one -- proving they
    // were routed as bundle-local, not pack-namespaced.
    for (const r of [r1, r2]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/no bundle module/);
    }
  });

  it('a near-miss like "scriptsEvil/x" is NOT treated as bundle-local (exact-segment match only)', async () => {
    const view = fixtureBundle({});
    const r = await run('return require("scriptsEvil/x")', { bundle: view });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/pack modules are not supported/);
  });
});

describe('buildRequire — pack-namespaced modules (seam only)', () => {
  it('an injected resolver can serve a pack module', async () => {
    const r = await run('return require("ana/http").ping', {
      packModuleResolver: (packName, modulePath) =>
        packName === 'ana' && modulePath === 'http'
          ? 'return { ping = "pong" }'
          : undefined,
    });
    expect(r).toEqual({ ok: true, value: 'pong' });
  });

  it('a resolver returning undefined (module not in that pack) fails softly', async () => {
    const r = await run('return require("ana/missing")', {
      packModuleResolver: () => undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/no pack module/);
      expect(r.message).not.toMatch(/MARK_CAPABILITY/);
    }
  });

  it('a nested pack path splits on the FIRST segment only: "ana/http/client" -> pack "ana", module "http/client"', async () => {
    let seen: [string, string] | undefined;
    await run('return require("ana/http/client")', {
      packModuleResolver: (packName, modulePath) => {
        seen = [packName, modulePath];
        return 'return 1';
      },
    });
    expect(seen).toEqual(['ana', 'http/client']);
  });
});

describe('buildRequire — cache and cycles', () => {
  it('a bundle-local module runs its side effect exactly once per run, cached on the second require', async () => {
    const view = fixtureBundle({
      'counted.lua': `
        __smd_test_counter = (__smd_test_counter or 0) + 1
        return __smd_test_counter
      `,
    });
    const r = await run(
      `
      local a = require("scripts/counted")
      local b = require("scripts/counted")
      return a == b and a or -1
      `,
      { bundle: view },
    );
    expect(r).toEqual({ ok: true, value: 1 });
  });

  it('a require cycle (A requires B, B requires A) is rejected cleanly, never hangs', async () => {
    const view = fixtureBundle({
      'a.lua': 'require("scripts/b"); return "a"',
      'b.lua': 'require("scripts/a"); return "b"',
    });
    const r = await run('return require("scripts/a")', { bundle: view });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/circular require/);
  }, 5_000);
});

describe('buildRequire — no bytecode, ever', () => {
  it('a resolved module beginning with the Lua bytecode signature is rejected before compiling', async () => {
    const bytecodeLike = '\x1bLua' + 'garbage-that-is-not-real-bytecode';
    const r = await run('return require("ana/evil")', {
      packModuleResolver: () => bytecodeLike,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('MARK_CAPABILITY');
      expect(r.message).toMatch(/precompiled\/binary chunk/);
    }
  });
});
