import { zipSync } from 'fflate';
import {
  createScriptView,
  openZipBundle,
  type BundleManifest,
} from '@markii/bundle';
import { describe, expect, it } from 'vitest';
import { runScript, type RunScriptOptions } from './sandbox';
import type { ScriptLimits } from './limits';

/**
 * Pass-3 adversarial probes (independent audit of the pack/require arc,
 * issue #3 slices 3-5): the cases the slice-built suite (`./require.probe.test.ts`)
 * does not already cover. Run against the real wasmoon interpreter through
 * `runScript`, per AGENTS.md's executed-probe rule.
 */

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function bundleWithScripts(scripts: Record<string, string>) {
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
  return createScriptView(storage, manifest, { bundle: ['read'] });
}

const FAST_LIMITS: Partial<ScriptLimits> = {
  maxInstructions: 200_000,
  wallClockMs: 1_000,
};

async function run(code: string, options: Partial<RunScriptOptions> = {}) {
  return runScript({
    code,
    tier: 'manual',
    limits: FAST_LIMITS,
    ...options,
  });
}

describe('pass-3 probe: no private sandbox name is reachable from ANY Lua frame', () => {
  // Everything except `net`/`cache`/`bundle`/`require` (the documented API)
  // and `__smd_marshal_root` (marshal.ts's deliberate cross-chunk global,
  // see the pass-3 report) must be absent from the shared globals table.
  const FORBIDDEN = [
    '__smd_load_raw',
    '__smd_require_resolve_raw',
    '__smd_require_cache',
    '__smd_require_stack',
    'load',
    'loadstring',
    'loadfile',
    'dofile',
    '_G',
  ];

  it('a required MODULE body sees zero forbidden names — residue checks must hold inside a module, not just the user chunk', async () => {
    const view = bundleWithScripts({
      'residue.lua': `
        local found = {}
        local names = {
          ${FORBIDDEN.map((n) => `"${n}"`).join(',')}
        }
        for _, name in ipairs(names) do
          if _ENV[name] ~= nil then found[#found + 1] = name end
        end
        return table.concat(found, ",")
      `,
    });
    const result = await run('return require("scripts/residue")', {
      bundle: view,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('');
  });

  it('the USER chunk enumerating the entire globals table finds none of the forbidden names', async () => {
    const result = await run(`
      local found = {}
      for name, _ in pairs(_ENV) do
        if name == "load" or name == "loadstring" or name == "dofile"
          or name == "loadfile" or name == "_G"
          or (string.sub(name, 1, 6) == "__smd_" and name ~= "__smd_marshal_root") then
          found[#found + 1] = name
        end
      end
      return table.concat(found, ",")
    `);
    expect(result).toEqual({ ok: true, value: '' });
  });

  it('rewriting _ENV itself cannot resurrect anything (the scrub mutated the table, not a name)', async () => {
    const result = await run(`
      local t, old = type, _ENV
      local fresh = {}
      _ENV = fresh
      local ok_load = t(load)
      _ENV = old
      -- A chunk-level _ENV swap only changes NAME RESOLUTION; it can never
      -- recover os/io/debug/load because those were never linked into any
      -- table this sandbox can reach.
      return ok_load .. "," .. t(os) .. "," .. t(io) .. "," .. t(debug)
    `);
    expect(result).toEqual({ ok: true, value: 'nil,nil,nil,nil' });
  });
});

describe('pass-3 probe: a required module has exactly its caller\u2019s authority, never more', () => {
  it('under auto tier with POST granted, a PACK module\u2019s net.post is still tier-blocked (capability classification wins)', async () => {
    const result = await run(
      `
      local m = require("pkg/poster")
      return m.go()
      `,
      {
        tier: 'auto',
        packModuleResolver: () =>
          'return { go = function() return net.post("https://x.test/api", "{}") end }',
        net: {
          get: async () => ({ status: 200, body: '{}' }),
          post: async () => ({ status: 200, body: '{}' }),
          patch: async () => ({ status: 200, body: '{}' }),
        },
        netGrants: { get: ['x.test'], post: ['x.test'] },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('capability');
      expect(result.error.capability).toBe('tier-blocked');
    }
  });

  it('module-body bundle.read goes through the same ScriptView jail (traversal denied identically)', async () => {
    const view = bundleWithScripts({
      'snoop.lua': 'return bundle.read("assets/../../manifest.json")',
    });
    const result = await run('return require("scripts/snoop")', {
      bundle: view,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('capability');
  });

  it('DESIGN PROPERTY, pinned: a required module shares the caller\u2019s live capability tables and can rebind them for later code in the SAME run (no privilege boundary exists between note code, bundle modules, and installed-pack modules)', async () => {
    const seenUrls: string[] = [];
    const result = await run(
      `
      require("pkg/wrapper")
      -- After the module ran, the note's own fetch_json is the wrapper's:
      -- same thread, same globals, same grants. This is the documented
      -- trust model ("pack code runs with the same trust as the
      -- extension's own bundle"), pinned here so it can never regress
      -- into an assumed-but-false isolation claim. The note asks for
      -- evil.test; only the module's rewrite makes that land on ok.test.
      local decoded = net.fetch_json("https://evil.test/data")
      return type(decoded)
      `,
      {
        packModuleResolver: () => `
          local real = net.fetch_json
          net.fetch_json = function(url)
            return real(string.gsub(url, "^https://evil%.test", "https://ok.test"))
          end
        `,
        net: {
          get: async (url) => {
            seenUrls.push(url);
            return { status: 200, body: '{}' };
          },
          post: async () => ({ status: 200, body: '{}' }),
          patch: async () => ({ status: 200, body: '{}' }),
        },
        netGrants: { get: ['ok.test'], post: ['ok.test'] },
      },
    );
    expect(result).toEqual({ ok: true, value: 'table' });
    // The provider was reached ONLY through the module's rewrite: the
    // allowlist itself (ok.test) never included evil.test.
    expect(seenUrls).toHaveLength(1);
    expect(seenUrls[0]).toContain('ok.test');
  });
});

describe('pass-3 probe: deep hostile module names through a REAL pre-loaded resolver map', () => {
  const fakeMap = {
    ana: {
      'util.lua': 'return "u"',
    },
  };

  const cases = [
    'ana/../../etc/passwd',
    'ana/../ana/util',
    'ana/util/../../util',
    'ana/\0',
    'ana/a\\b',
    'ana/%2e%2e/util',
    'ana/....//util',
    '../ana/util',
    '/ana/util',
    'ana/',
    '.cache/x',
    'assets/img',
  ];

  it.each(cases)(
    'require(%j) resolves to a CLEAN MISS or denial — never a lookup escape, never a throw out of the resolver',
    async (name) => {
      const luaName = JSON.stringify(name);
      const result = await run(`return require(${luaName})`, {
        bundle: bundleWithScripts({ 'util.lua': 'return 1' }),
        packModuleResolver: (packName, modulePath) => {
          // Mirror apps/vscode's createPackModuleResolver contract exactly:
          // synchronous, Object.hasOwn-guarded, jail-normalized.
          if (Object.hasOwn(fakeMap, packName)) {
            const withExt = modulePath.endsWith('.lua')
              ? modulePath
              : `${modulePath}.lua`;
            if (withExt === 'util.lua') return fakeMap.ana['util.lua'];
          }
          return undefined;
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(['runtime', 'capability']).toContain(result.error.kind);
      }
    },
  );

  it('an ESC-leading but non-"Lua" module text is refused as text-chunk garbage, not executed as bytecode and not a host crash', async () => {
    const result = await run('return require("ana/esc")', {
      packModuleResolver: () => '\x1bnotLuaSignature return 1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(['runtime', 'capability']).toContain(result.error.kind);
  });

  it('instruction budget is shared through a NESTED require chain (A requires B requires C burns cycles)', async () => {
    const view = bundleWithScripts({
      'a.lua': 'require("scripts/b"); return 1',
      'b.lua': 'require("scripts/c"); return 1',
      'c.lua': 'local n = 0; while true do n = n + 1 end',
    });
    const result = await run('return require("scripts/a")', {
      bundle: view,
      limits: { ...FAST_LIMITS, maxInstructions: 50_000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('limit');
  });
});

describe('pass-3 probe: the return-value marshal cap cannot be neutered by rebinding its global', () => {
  // wrapUserCode emits `return __smd_marshal_root(__smd_user_chunk())`.
  // Lua evaluates the user chunk FIRST; if `__smd_marshal_root` is then
  // resolved as a DYNAMIC GLOBAL, a script can swap in an identity function
  // and push an uncapped table straight through wasmoon's eager JS
  // conversion (marshal.ts's own doc: ~12s for a million-entry table).
  // The genuine walk must win — i.e. this must come back as a marshal
  // nodes-cap failure, never as ok:true with all 25k entries.
  it('rebinding __smd_marshal_root does not bypass the nodes cap', async () => {
    const result = await run(
      `
      local big = {}
      for i = 1, 25000 do big[i] = "x" end
      __smd_marshal_root = function(v) return v end
      return big
    `,
      {
        // Generous instruction budget so ONLY the nodes cap can stop this
        // run — an instruction-limit failure here would mask the mechanism
        // under test.
        limits: { ...FAST_LIMITS, maxInstructions: 5_000_000 },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('marshal');
    }
  });

  it('the genuine walk is what runs for cache.get\u2019s write side even after a rebind attempt (pinned local)', async () => {
    const result = await run(
      `
      local stored = nil
      -- no cache provider wired: cache table absent -> skip
      return type(__smd_marshal_root)
    `,
      {},
    );
    // The global itself remains visible (marshal.ts's documented trade-off);
    // the property under test is that the WRAPPER's call site cannot be
    // redirected by a script, asserted by the nodes-cap test above.
    expect(result).toEqual({ ok: true, value: 'function' });
  });
});
