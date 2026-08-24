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
 * Executed adversarial probe suite for `./require` (issue #3, slice 3),
 * committed as product code per AGENTS.md — this is the security-relevant
 * behavior probe for the sandboxed `require`, run against the REAL wasmoon
 * interpreter through `runScript` end to end (never a mock of the VM). A
 * separate, later slice runs the full independent adversarial audit pass;
 * this suite covers what THIS slice built: the bundle-local path-jail
 * reuse, the pack-namespace denial-with-no-resolver seam, bytecode
 * rejection, cache/cycle behavior, and tier gating.
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
  maxInstructions: 2_000_000,
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

describe('require probe — path traversal in module names is rejected, never escapes the bundle', () => {
  const view = bundleWithScripts({ 'util.lua': 'return 1' });

  it.each([
    'scripts/../../etc/passwd',
    'scripts/../../etc/passwd.lua',
    'scripts/../manifest.json',
    '../scripts/util',
  ])('require(%j) is denied, not resolved', async (name) => {
    const result = await run(`return require(${JSON.stringify(name)})`, {
      bundle: view,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Every one of these is caught by @markii/bundle's own path-jail
      // (`normalizeBundlePath`, reused unmodified via `ScriptView.read`),
      // which throws a `BundlePathError` -- surfaced here as a capability
      // denial, exactly like an equivalent `bundle.read` call would be.
      expect(result.error.kind).toBe('capability');
    }
  });

  it('a trailing ".." with nothing after it never reaches storage either — require.ts\'s own ".lua"-suffix step turns it into a harmless, still-nonexistent filename ("scripts/...lua"), and a nonexistent module still fails, just as an ordinary "not found" rather than a jail rejection', async () => {
    const result = await run('return require("scripts/..")', {
      bundle: view,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('runtime');
      expect(result.error.message).toMatch(/no bundle module/);
    }
  });

  it('an absolute path is never treated as a bundle path (no leading reserved-dir segment)', async () => {
    const result = await run('return require("/etc/passwd")', {
      bundle: view,
    });
    expect(result.ok).toBe(false);
    // Routed as a pack namespace ("" as the pack name) with no resolver
    // configured -- denied before ever reaching bundle storage.
    if (!result.ok) expect(result.error.kind).toBe('capability');
  });
});

describe('require probe — no bytecode, ever', () => {
  it('a bundle-local file containing the Lua bytecode signature is rejected, not executed', async () => {
    const view = bundleWithScripts({
      'evil.lua': '\x1bLua' + 'not-real-bytecode-but-has-the-signature',
    });
    const result = await run('return require("scripts/evil")', {
      bundle: view,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('capability');
      expect(result.error.message).toMatch(/precompiled\/binary chunk/);
    }
  });

  it('a pack module resolver handing back a bytecode-signature string is rejected the same way', async () => {
    const result = await run('return require("ana/evil")', {
      packModuleResolver: () => '\x1bLua' + 'garbage',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('capability');
  });

  it('the public `load` name is nil in a fresh sandbox engine (first defense layer)', async () => {
    // A script can never reach `load` directly under any name, including
    // before require.ts's own prelude runs -- `./globals`' scrub removes
    // the public name immediately after capturing the real primitive into
    // the private `__smd_load_raw` that only require.ts's prelude
    // consumes. The IN-LUA "t"-mode gate on that captured primitive is
    // exercised end to end by the bytecode-signature tests above (a real
    // bytecode-shaped module, routed through the actual `require()` call).
    const { createEmptyLuaEngine } = await import('./globals');
    const engine = await createEmptyLuaEngine();
    try {
      expect(await engine.doString('return type(load)')).toBe('nil');
    } finally {
      engine.global.close();
    }
  });
});

describe('require probe — network/filesystem escape attempts', () => {
  it('a required module has no `net`/`bundle`/`io`/`os` surface beyond what the run itself already grants', async () => {
    const view = bundleWithScripts({
      'probe.lua': `
        return {
          net = type(net),
          io = type(io),
          os = type(os),
          load = type(load),
          require_is_function = type(require) == "function",
        }
      `,
    });
    const result = await run(
      'local m = require("scripts/probe"); return m',
      { bundle: view }, // deliberately no `net` provider configured
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        net: 'nil',
        io: 'nil',
        os: 'nil',
        load: 'nil',
        require_is_function: true,
      });
    }
  });

  it('a module cannot reach `load`/`loadstring` under any name to escape the sandbox', async () => {
    const view = bundleWithScripts({
      'probe.lua':
        'return type(load) .. "," .. type(loadstring) .. "," .. type(dofile)',
    });
    const result = await run('return require("scripts/probe")', {
      bundle: view,
    });
    expect(result).toEqual({ ok: true, value: 'nil,nil,nil' });
  });
});

describe('require probe — non-existent module fails cleanly, not a crash', () => {
  it('a well-formed but absent bundle-local module', async () => {
    const view = bundleWithScripts({});
    const result = await run('return require("scripts/nope")', {
      bundle: view,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('runtime');
  });
});

describe('require probe — require cycle does not hang', () => {
  it('A -> B -> A is rejected quickly, well under the wall-clock limit', async () => {
    const view = bundleWithScripts({
      'a.lua': 'require("scripts/b"); return 1',
      'b.lua': 'require("scripts/a"); return 1',
    });
    const started = Date.now();
    const result = await run('return require("scripts/a")', { bundle: view });
    const elapsedMs = Date.now() - started;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('runtime');
      expect(result.error.message).toMatch(/circular require/);
    }
    // Bounded, not "eventually" -- proves this terminates on its own via
    // the in-progress-stack check, not via the wall-clock kill.
    expect(elapsedMs).toBeLessThan(FAST_LIMITS.wallClockMs!);
  });

  it('a module requiring itself directly is also rejected cleanly', async () => {
    const view = bundleWithScripts({
      'self.lua': 'require("scripts/self"); return 1',
    });
    const result = await run('return require("scripts/self")', {
      bundle: view,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/circular require/);
  });
});

describe('require probe — per-run module cache, isolated across runs', () => {
  it('a module runs its side effect once within a run, and a fresh run does not see the prior cache', async () => {
    const view = bundleWithScripts({
      'counted.lua': `
        __smd_probe_counter = (__smd_probe_counter or 0) + 1
        return __smd_probe_counter
      `,
    });
    const withinOneRun = await run(
      `
      local a = require("scripts/counted")
      local b = require("scripts/counted")
      local c = require("scripts/counted")
      return { a, b, c }
      `,
      { bundle: view },
    );
    expect(withinOneRun).toEqual({ ok: true, value: [1, 1, 1] });

    // A brand-new runScript call gets a brand-new engine (torn down and
    // rebuilt every call -- see ./sandbox's own doc comment) -- so the
    // module's internal counter (a Lua global, `__smd_probe_counter`) and
    // require's own per-run cache both start over.
    const freshRun = await run('return require("scripts/counted")', {
      bundle: view,
    });
    expect(freshRun).toEqual({ ok: true, value: 1 });
  });
});

describe('require probe — tier gating: bundle-local require is read-only, allowed under auto', () => {
  it('an auto-tier run can still require a bundle-local module (it only ever reads)', async () => {
    const view = bundleWithScripts({ 'util.lua': 'return "ok"' });
    const result = await run('return require("scripts/util")', {
      tier: 'auto',
      bundle: view,
    });
    expect(result).toEqual({ ok: true, value: 'ok' });
  });

  it('a required module cannot reach bundle.write even under manual tier from inside its own body', async () => {
    const view = bundleWithScripts({
      'probe.lua': `
        local ok, err = pcall(function() return bundle.write("cache/x.json", "1") end)
        return { ok = ok, err = tostring(err) }
      `,
    });
    // No write grant declared on the fixture manifest at all -- write
    // should fail regardless of tier, exactly as bundle.write already does
    // for top-level script code.
    const result = await run('return require("scripts/probe")', {
      tier: 'manual',
      bundle: view,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value = result.value as { ok: boolean; err: string };
      expect(value.ok).toBe(false);
    }
  });
});

describe('require probe — pack-namespaced require with no resolver injected', () => {
  it('resolves to a clean capability denial, not a crash, when no packModuleResolver is configured', async () => {
    const result = await run('return require("ana/http")');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('capability');
      expect(result.error.capability).toBe('denied');
      expect(result.error.message).toMatch(/pack modules are not supported/);
    }
  });

  it('an injected resolver is honored end to end through runScript', async () => {
    const result = await run('return require("ana/http").ping()', {
      packModuleResolver: (packName, modulePath) =>
        packName === 'ana' && modulePath === 'http'
          ? 'return { ping = function() return "pong" end }'
          : undefined,
    });
    expect(result).toEqual({ ok: true, value: 'pong' });
  });
});

describe("require probe — a required module shares the run's resource budget (cannot escape the caps)", () => {
  it('an instruction-hungry module still gets killed by the shared limit, not run unboundedly', async () => {
    const view = bundleWithScripts({
      'burn.lua': `
        local n = 0
        while true do n = n + 1 end
        return n
      `,
    });
    const result = await run('return require("scripts/burn")', {
      bundle: view,
      limits: { ...FAST_LIMITS, maxInstructions: 50_000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('limit');
    }
  });
});
