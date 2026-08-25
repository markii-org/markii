/**
 * End-to-end coverage of `./pack-build.ts` against a REAL, minimal `.tsx`
 * pack fixture (`test-fixtures/packs/tsxpack/`) — proving the whole
 * compile-from-source path works together on an actual pack shape: real
 * manifest parsing and a REAL esbuild-wasm invocation (no fakes — that is
 * `pack-build.test.ts`'s job, for the fast cache/failure-path coverage).
 *
 * The actual `buildPackRegistrationScript` call runs in a genuinely
 * separate `node` child process (spawned below, running the source
 * directly via `tsx/cjs` — the SAME dev-mode mechanism `./run/run-host.ts`'s
 * `TSX_DEV_EXEC_ARGV` already uses to run a `worker_threads` worker straight
 * from `.ts` source), never inside Vitest's own module realm. This is not a
 * style choice: esbuild-wasm's browser (in-process WebAssembly) entry runs
 * a startup invariant check that fails when evaluated inside Vitest's
 * per-file `vm` module-transform context — confirmed empirically against
 * this exact environment (plain `environment: 'node'`, no jsdom involved) —
 * because typed-array/WebAssembly intrinsics differ across `vm` realms even
 * when the requiring code path is otherwise ordinary. The PRODUCTION path
 * never hits this: a host's extension/plugin process is a plain,
 * unsandboxed process, not a Vitest worker.
 *
 * Everything that does NOT need esbuild-wasm itself (reading the compiled
 * output, evaluating it against a fake `window` via `vm.runInContext`)
 * runs in this file's own process as usual — only the build call is
 * isolated.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import vm from 'node:vm';
import type { PackBuildOutcome } from './pack-build.js';

const FIXTURE_ROOT = path.resolve(
  import.meta.dirname,
  '../../test-fixtures/packs',
);
const TSXPACK_DIR = path.join(FIXTURE_ROOT, 'tsxpack');
/** `../../test-fixtures/packs/tsxpack-css`: a real `.tsx` pack that imports its own CSS (`import './Stat.css'`) — clean, correctly prefixed, token-based content (see that fixture's doc comments). */
const TSXPACK_CSS_DIR = path.join(FIXTURE_ROOT, 'tsxpack-css');
/** `../../test-fixtures/packs/tsxpack-badcss`: the same shape, but its CSS deliberately breaks both `./pack-css-lint.ts` rules. */
const TSXPACK_BADCSS_DIR = path.join(FIXTURE_ROOT, 'tsxpack-badcss');
/**
 * `../../test-fixtures/packs/tsxpack-helpers`: the real-vault shape that
 * exposed the regression this test file's "helper modules" describe block
 * guards — a component importing an extensionless relative helper, a
 * helper importing a further extensionless helper, a directory `index`
 * import, and CSS imported from a non-entry module (`helper.ts`, not
 * `Stat.tsx`).
 */
const TSXPACK_HELPERS_DIR = path.join(FIXTURE_ROOT, 'tsxpack-helpers');
/** `../../test-fixtures/packs/tsxpack-jailbreak` (+ its sibling `tsxpack-jailbreak-outside`): a component that imports a relative module OUTSIDE the pack's own folder — must be refused, never bundled. */
const TSXPACK_JAILBREAK_DIR = path.join(FIXTURE_ROOT, 'tsxpack-jailbreak');
/** `../../test-fixtures/packs/tsxpack-barespecifier`: a component that imports a bare package specifier other than `react`/`react-dom` — unresolvable by contract (packs are self-contained), must degrade to a recorded reason. */
const TSXPACK_BARESPECIFIER_DIR = path.join(
  FIXTURE_ROOT,
  'tsxpack-barespecifier',
);
const PACK_BUILD_TS = path.join(import.meta.dirname, 'pack-build.ts');

/**
 * Runs the real `buildPackRegistrationScript` in a genuinely separate
 * `node` process (see this file's top doc comment for why). Writes a small
 * throwaway driver script into `workDir` and shells out to it. Reads
 * `pack.json` and the declared component paths directly — a minimal stand-in
 * for a host's own discovery module (`apps/vscode/src/packs/discover.ts`),
 * which is host-specific and does not live in this package; this builder
 * only needs a `PackBuildSource` (folder, manifest, componentPaths), and a
 * fixture pack's `pack.json` here always declares exactly one component,
 * `stat`, at `./Stat.tsx`.
 */
function buildInChildProcess(
  packDir: string,
  cacheDir: string,
  workDir: string,
): PackBuildOutcome {
  const driverPath = path.join(workDir, 'run-build.cjs');
  const driverSource = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { buildPackRegistrationScript } = require(${JSON.stringify(PACK_BUILD_TS)});
    (async () => {
      const packDir = ${JSON.stringify(packDir)};
      const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'pack.json'), 'utf8'));
      const componentPaths = {};
      for (const [localName, relativePath] of Object.entries(manifest.components)) {
        componentPaths[localName] = path.join(packDir, relativePath);
      }
      const pack = { folder: packDir, manifest, componentPaths };
      const outcome = await buildPackRegistrationScript(pack, ${JSON.stringify(cacheDir)});
      process.stdout.write(JSON.stringify(outcome));
    })().catch((err) => {
      process.stdout.write(JSON.stringify({ kind: 'failed', reason: String(err && err.stack || err) }));
    });
  `;
  writeFileSync(driverPath, driverSource, 'utf8');

  const output = execFileSync('node', ['--require', 'tsx/cjs', driverPath], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return JSON.parse(output) as PackBuildOutcome;
}

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-pack-build-fixture-'));
  tempDirs.push(dir);
  return dir;
}

async function cleanupTempDirs(): Promise<void> {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
}

interface SandboxWindow {
  __markiiPackRegistrations: Array<{
    manifest: unknown;
    componentModules: unknown;
  }>;
  __markiiRegisterPack: (manifest: unknown, componentModules: unknown) => void;
  __markiiReact?: unknown;
}

/** A minimal fake `window` — a plain object, not a real DOM — with a `__markiiReact` accessor that COUNTS every read, so a test can assert nothing touches it before an explicit render call. */
function makeSandbox(): {
  context: vm.Context;
  windowObj: SandboxWindow;
  reactAccessCount: () => number;
  allowReact: (value: unknown) => void;
} {
  let accessCount = 0;
  let reactValue: unknown;
  const windowObj = {
    __markiiPackRegistrations: [],
    __markiiRegisterPack(manifest: unknown, componentModules: unknown) {
      windowObj.__markiiPackRegistrations.push({ manifest, componentModules });
    },
  } as SandboxWindow;
  Object.defineProperty(windowObj, '__markiiReact', {
    configurable: true,
    get() {
      accessCount += 1;
      return reactValue;
    },
  });

  const context = vm.createContext({ window: windowObj, console });
  return {
    context,
    windowObj,
    reactAccessCount: () => accessCount,
    allowReact: (value) => {
      reactValue = value;
    },
  };
}

describe('buildPackRegistrationScript — real esbuild-wasm against the tsxpack fixture', () => {
  it('compiles the real fixture, produces valid JS that registers, and never reads window.__markiiReact before invocation', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();
    try {
      const outcome = buildInChildProcess(TSXPACK_DIR, cacheDir, workDir);
      expect(outcome.kind).toBe('built');
      if (outcome.kind !== 'built') return;

      // (c) no bundled copy of React: real React is tens of KB and
      // carries telltale internals; this compiled output should be a
      // few hundred bytes and never reference them.
      const source = await readFile(outcome.scriptPath, 'utf8');
      expect(source.length).toBeLessThan(5000);
      expect(source).not.toContain('ReactCurrentDispatcher');
      expect(source).not.toContain('REACT_ELEMENT_TYPE');

      const { context, windowObj, reactAccessCount, allowReact } =
        makeSandbox();

      // (a) valid JS: a syntax error would throw here.
      expect(() => {
        vm.runInContext(source, context, {
          filename: 'tsxpack-registration.js',
        });
      }).not.toThrow();

      // (d) never reads window.__markiiReact at top level: the script
      // just loaded (the `vm.runInContext` call above), and nothing has
      // invoked any component yet.
      expect(reactAccessCount()).toBe(0);

      // (b) calls window.__markiiRegisterPack: the sandbox captured it.
      expect(windowObj.__markiiPackRegistrations).toHaveLength(1);
      const registration = windowObj.__markiiPackRegistrations[0] as {
        manifest: unknown;
        componentModules: Record<
          string,
          { component: unknown; inline?: boolean }
        >;
      };
      expect(typeof registration.manifest).toBe('string');
      expect(JSON.parse(registration.manifest as string)).toEqual({
        name: 'tsxpack',
        engine: 'react',
        components: { stat: './Stat.tsx' },
      });
      expect(typeof registration.componentModules.stat?.component).toBe(
        'function',
      );
      expect(registration.componentModules.stat?.inline).toBe(false);

      // Now allow window.__markiiReact and actually render the
      // component — this is the FIRST point any access should happen.
      allowReact({
        createElement: (
          type: unknown,
          props: unknown,
          ...children: unknown[]
        ) => ({ type, props, children }),
        Fragment: 'markii-fragment-marker',
        useState: (initial: unknown) => [initial, () => undefined],
      });

      const Stat = registration.componentModules.stat!.component as (
        props: unknown,
      ) => unknown;
      const element = Stat({ attributes: { label: 'hits' }, children: null });

      expect(reactAccessCount()).toBeGreaterThan(0);
      expect(element).toEqual(
        expect.objectContaining({ type: 'markii-fragment-marker' }),
      );
    } finally {
      await cleanupTempDirs();
    }
  }, 30_000);

  it('a host reload (fresh pack-build module, esbuild-wasm still in the require cache) builds again instead of dying on a second initialize', async () => {
    // The real-vault failure this guards: Obsidian re-evaluates a plugin's
    // main.js on disable/enable, so pack-build's module-level init cache is
    // gone, but the renderer's require cache still holds the ALREADY
    // INITIALIZED esbuild-wasm instance — whose initialize() may be called
    // only once. The driver below performs exactly that sequence in one
    // process: build, evict pack-build (not esbuild-wasm) from the require
    // cache, re-require, build again into a fresh cache dir (so the second
    // build cannot shortcut through a cache hit).
    const packDir = path.join(await makeTempDir(), 'tsxpack');
    await cp(TSXPACK_DIR, packDir, { recursive: true });
    const cacheDirA = await makeTempDir();
    const cacheDirB = await makeTempDir();
    const workDir = await makeTempDir();

    const driverPath = path.join(workDir, 'run-reload.cjs');
    const driverSource = `
      const fs = require('node:fs');
      const path = require('node:path');
      const packBuildPath = ${JSON.stringify(PACK_BUILD_TS)};
      const packDir = ${JSON.stringify(packDir)};
      function packSource() {
        const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'pack.json'), 'utf8'));
        const componentPaths = {};
        for (const [localName, relativePath] of Object.entries(manifest.components)) {
          componentPaths[localName] = path.join(packDir, relativePath);
        }
        return { folder: packDir, manifest, componentPaths };
      }
      (async () => {
        const first = await require(packBuildPath).buildPackRegistrationScript(packSource(), ${JSON.stringify(cacheDirA)});
        for (const key of Object.keys(require.cache)) {
          if (!key.includes('esbuild-wasm')) delete require.cache[key];
        }
        const second = await require(packBuildPath).buildPackRegistrationScript(packSource(), ${JSON.stringify(cacheDirB)});
        process.stdout.write(JSON.stringify({ first: first.kind, second }));
      })().catch((err) => {
        process.stdout.write(JSON.stringify({ first: 'threw', second: { kind: 'failed', reason: String(err && err.stack || err) } }));
      });
    `;
    writeFileSync(driverPath, driverSource, 'utf8');
    const output = execFileSync('node', ['--require', 'tsx/cjs', driverPath], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    const { first, second } = JSON.parse(output) as {
      first: string;
      second: PackBuildOutcome;
    };
    expect(first).toBe('built');
    expect(second.kind).toBe('built');
  });

  it('a second call for the same fixture is a cache hit (no change in output, same path)', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();
    try {
      const first = buildInChildProcess(TSXPACK_DIR, cacheDir, workDir);
      const second = buildInChildProcess(TSXPACK_DIR, cacheDir, workDir);

      expect(first.kind).toBe('built');
      expect(second.kind).toBe('built');
      if (first.kind === 'built' && second.kind === 'built') {
        expect(second.scriptPath).toBe(first.scriptPath);
      }
    } finally {
      await cleanupTempDirs();
    }
  }, 30_000);

  it('the tsxpack fixture (no CSS import) emits no stylesheet', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();
    try {
      const outcome = buildInChildProcess(TSXPACK_DIR, cacheDir, workDir);
      expect(outcome.kind).toBe('built');
      if (outcome.kind === 'built') {
        expect(outcome.stylesheetPath).toBeUndefined();
        expect(outcome.warnings).toEqual([]);
      }
    } finally {
      await cleanupTempDirs();
    }
  }, 30_000);

  it('a pack that imports CSS (tsxpack-css) emits a real stylesheet sibling of the script, with the pack rules in it and no lint warnings', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();
    try {
      const outcome = buildInChildProcess(TSXPACK_CSS_DIR, cacheDir, workDir);
      expect(outcome.kind).toBe('built');
      if (outcome.kind !== 'built') return;

      expect(outcome.stylesheetPath).toBeDefined();
      const stylesheetPath = outcome.stylesheetPath!;
      // Sibling of the script: same directory, same content-hash base name.
      expect(path.dirname(stylesheetPath)).toBe(
        path.dirname(outcome.scriptPath),
      );
      expect(path.basename(stylesheetPath, '.css')).toBe(
        path.basename(outcome.scriptPath, '.js'),
      );

      const css = await readFile(stylesheetPath, 'utf8');
      expect(css).toContain('.mk-tsxcss-stat');
      expect(css).toContain('--mk-fg');

      expect(outcome.warnings).toEqual([]);
    } finally {
      await cleanupTempDirs();
    }
  }, 30_000);

  it('a pack whose CSS breaks both lint rules (tsxpack-badcss) still builds, with both warnings against the real emitted CSS', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();
    try {
      const outcome = buildInChildProcess(
        TSXPACK_BADCSS_DIR,
        cacheDir,
        workDir,
      );
      expect(outcome.kind).toBe('built');
      if (outcome.kind !== 'built') return;

      expect(outcome.stylesheetPath).toBeDefined();
      const css = await readFile(outcome.stylesheetPath!, 'utf8');
      expect(css).toContain('#123456');

      expect(outcome.warnings.length).toBe(2);
      expect(
        outcome.warnings.some((w) => w.includes('raw color literal')),
      ).toBe(true);
      expect(outcome.warnings.some((w) => w.includes('required prefix'))).toBe(
        true,
      );
      expect(outcome.warnings.every((w) => w.includes('tsxbadcss'))).toBe(true);
    } finally {
      await cleanupTempDirs();
    }
  }, 30_000);

  it('a CSS-only change busts the cache, even with the .tsx source byte-for-byte unchanged', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();
    const mutableDir = await makeTempDir();
    try {
      await cp(TSXPACK_CSS_DIR, mutableDir, { recursive: true });

      const first = buildInChildProcess(mutableDir, cacheDir, workDir);
      expect(first.kind).toBe('built');
      if (first.kind !== 'built') return;

      // Edit ONLY the CSS file — the .tsx source is untouched.
      const cssPath = path.join(mutableDir, 'Stat.css');
      const original = await readFile(cssPath, 'utf8');
      await writeFile(
        cssPath,
        `${original}\n.mk-tsxcss-stat { padding: 4px; }\n`,
        'utf8',
      );

      const second = buildInChildProcess(mutableDir, cacheDir, workDir);
      expect(second.kind).toBe('built');
      if (second.kind !== 'built') return;

      expect(second.scriptPath).not.toBe(first.scriptPath); // CSS-only edit is a cache miss
      expect(second.stylesheetPath).not.toBe(first.stylesheetPath);
      const css = await readFile(second.stylesheetPath!, 'utf8');
      expect(css).toContain('padding: 4px');
    } finally {
      await cleanupTempDirs();
    }
  }, 30_000);

  describe('helper modules (the real-vault shape: extensionless import, transitive helper, directory index, non-entry CSS)', () => {
    it('compiles tsxpack-helpers and bundles every hop of the helper chain', async () => {
      const workDir = await makeTempDir();
      const cacheDir = await makeTempDir();
      try {
        const outcome = buildInChildProcess(
          TSXPACK_HELPERS_DIR,
          cacheDir,
          workDir,
        );
        expect(outcome.kind).toBe('built');
        if (outcome.kind !== 'built') return;

        const source = await readFile(outcome.scriptPath, 'utf8');
        // `deep.ts` (a helper's own helper) and `util/index.ts` (a
        // directory `index` import) are both two-plus hops from the
        // declared component — their marker strings appearing in the
        // compiled output is the only real proof every hop resolved.
        expect(source).toContain('deep-marker-9f3c');
        expect(source).toContain('util-marker-2b7a');

        // CSS imported from `helper.ts` — a NON-entry module — still
        // produces the sibling stylesheet, same as a direct import would.
        expect(outcome.stylesheetPath).toBeDefined();
        const css = await readFile(outcome.stylesheetPath!, 'utf8');
        expect(css).toContain('.mk-tsxhelpers-marker');
        expect(outcome.warnings).toEqual([]);
      } finally {
        await cleanupTempDirs();
      }
    }, 30_000);

    it('editing a transitively-imported helper (deep.ts) busts the cache even though Stat.tsx is byte-for-byte unchanged', async () => {
      const workDir = await makeTempDir();
      const cacheDir = await makeTempDir();
      const mutableDir = await makeTempDir();
      try {
        await cp(TSXPACK_HELPERS_DIR, mutableDir, { recursive: true });

        const first = buildInChildProcess(mutableDir, cacheDir, workDir);
        expect(first.kind).toBe('built');
        if (first.kind !== 'built') return;

        // Edit ONLY deep.ts — two hops from the declared component, and
        // never itself declared in pack.json or statically scanned.
        const deepPath = path.join(mutableDir, 'deep.ts');
        const original = await readFile(deepPath, 'utf8');
        await writeFile(
          deepPath,
          original.replace('deep-marker-9f3c', 'deep-marker-CHANGED'),
          'utf8',
        );

        const second = buildInChildProcess(mutableDir, cacheDir, workDir);
        expect(second.kind).toBe('built');
        if (second.kind !== 'built') return;

        const source = await readFile(second.scriptPath, 'utf8');
        expect(source).toContain('deep-marker-CHANGED');
        expect(source).not.toContain('deep-marker-9f3c');
      } finally {
        await cleanupTempDirs();
      }
    }, 30_000);

    it('a second call with nothing changed is a cache hit (same script path, same content)', async () => {
      const workDir = await makeTempDir();
      const cacheDir = await makeTempDir();
      const mutableDir = await makeTempDir();
      try {
        await cp(TSXPACK_HELPERS_DIR, mutableDir, { recursive: true });

        const first = buildInChildProcess(mutableDir, cacheDir, workDir);
        expect(first.kind).toBe('built');
        if (first.kind !== 'built') return;

        const second = buildInChildProcess(mutableDir, cacheDir, workDir);
        expect(second.kind).toBe('built');
        if (second.kind !== 'built') return;

        expect(second.scriptPath).toBe(first.scriptPath);
        expect(second.stylesheetPath).toBe(first.stylesheetPath);
      } finally {
        await cleanupTempDirs();
      }
    }, 30_000);
  });

  describe('refusals degrade to a recorded reason, never a throw', () => {
    it('an import that resolves outside the pack folder is refused', async () => {
      const workDir = await makeTempDir();
      const cacheDir = await makeTempDir();
      try {
        const outcome = buildInChildProcess(
          TSXPACK_JAILBREAK_DIR,
          cacheDir,
          workDir,
        );
        expect(outcome.kind).toBe('failed');
        if (outcome.kind !== 'failed') return;
        expect(outcome.reason).toContain('tsxjailbreak');
        expect(outcome.reason.toLowerCase()).toContain('outside');
      } finally {
        await cleanupTempDirs();
      }
    }, 30_000);

    it('an unresolvable bare specifier is refused', async () => {
      const workDir = await makeTempDir();
      const cacheDir = await makeTempDir();
      try {
        const outcome = buildInChildProcess(
          TSXPACK_BARESPECIFIER_DIR,
          cacheDir,
          workDir,
        );
        expect(outcome.kind).toBe('failed');
        if (outcome.kind !== 'failed') return;
        expect(outcome.reason).toContain('tsxbarespecifier');
        expect(outcome.reason).toContain('left-pad');
      } finally {
        await cleanupTempDirs();
      }
    }, 30_000);
  });
});
