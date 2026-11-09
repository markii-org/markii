/**
 * Real esbuild-wasm build of a pack's terminal script (`terminal.js`),
 * against `test-fixtures/packs/termpack/`. The build runs in a separate
 * `node` process for the same reason `pack-build.fixture.test.ts` does
 * (esbuild-wasm's startup check fails inside Vitest's vm realm); the output
 * is evaluated here through a `data:` URL import, exactly as the terminal
 * engine's loader evaluates it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { PackBuildOutcome } from './pack-build.js';

const TERMPACK_DIR = path.resolve(
  import.meta.dirname,
  '../test-fixtures/packs/termpack',
);
const PACK_BUILD_TS = path.join(import.meta.dirname, 'pack-build.ts');

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-term-build-'));
  tempDirs.push(dir);
  return dir;
}

function buildInChildProcess(
  kind: 'terminal' | 'webview',
  packDir: string,
  cacheDir: string,
  workDir: string,
): PackBuildOutcome {
  const driverPath = path.join(workDir, 'run-build.cjs');
  const fn =
    kind === 'terminal'
      ? 'buildPackTerminalScript'
      : 'buildPackRegistrationScript';
  writeFileSync(
    driverPath,
    `
    const fs = require('node:fs');
    const path = require('node:path');
    const { ${fn} } = require(${JSON.stringify(PACK_BUILD_TS)});
    (async () => {
      const packDir = ${JSON.stringify(packDir)};
      const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'pack.json'), 'utf8'));
      const componentPaths = {};
      const ansi = {};
      for (const [name, entry] of Object.entries(manifest.components)) {
        if (typeof entry === 'string') componentPaths[name] = path.join(packDir, entry);
        else {
          if (entry.sources.react) componentPaths[name] = path.join(packDir, entry.sources.react);
          if (entry.sources.ansi) ansi[name] = path.join(packDir, entry.sources.ansi);
        }
      }
      const pack = { folder: packDir, manifest, componentPaths, componentPathsByEngine: { react: componentPaths, ansi } };
      process.stdout.write(JSON.stringify(await ${fn}(pack, ${JSON.stringify(cacheDir)})));
    })().catch((err) => {
      process.stdout.write(JSON.stringify({ kind: 'failed', reason: String(err && err.stack || err) }));
    });
  `,
    'utf8',
  );
  const output = execFileSync('node', ['--require', 'tsx/cjs', driverPath], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return JSON.parse(output) as PackBuildOutcome;
}

async function evaluate(script: string): Promise<{
  registrations: { manifestJson: unknown; modules: Record<string, unknown> }[];
}> {
  const g = globalThis as Record<string, unknown>;
  const previous = g['__markiiRegisterTerminalPack'];
  const registrations: {
    manifestJson: unknown;
    modules: Record<string, unknown>;
  }[] = [];
  g['__markiiRegisterTerminalPack'] = (
    manifestJson: unknown,
    modules: Record<string, unknown>,
  ) => registrations.push({ manifestJson, modules });
  try {
    const nonce = `\n//# nonce=${String(Math.random())}`;
    const url = `data:text/javascript;base64,${Buffer.from(script + nonce, 'utf8').toString('base64')}`;
    await import(/* @vite-ignore */ url);
  } finally {
    if (previous === undefined) delete g['__markiiRegisterTerminalPack'];
    else g['__markiiRegisterTerminalPack'] = previous;
  }
  return { registrations };
}

describe('buildPackTerminalScript against the termpack fixture', () => {
  it('builds a self-contained ESM module that registers only the ansi components', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();
    const outcome = buildInChildProcess(
      'terminal',
      TERMPACK_DIR,
      cacheDir,
      workDir,
    );
    expect(outcome.kind).toBe('built');
    if (outcome.kind !== 'built') return;
    expect(path.basename(outcome.scriptPath)).toMatch(/^termpack-terminal-/);

    const source = await readFile(outcome.scriptPath, 'utf8');
    // Self-contained: it is imported from a data: URL, so nothing may import.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).not.toContain('ReactCurrentDispatcher');
    expect(source).not.toContain('react only');

    // Evaluating with React and Ink globals undefined must not throw.
    const g = globalThis as Record<string, unknown>;
    delete g['__markiiReactInk'];
    delete g['__markiiInk'];
    const { registrations } = await evaluate(source);
    expect(registrations).toHaveLength(1);
    const [only] = registrations;
    expect(typeof only?.manifestJson).toBe('string');
    expect(Object.keys(only?.modules ?? {})).toEqual(['meter']);
  });

  it('reads react and ink through the host globals only at render time', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();
    const outcome = buildInChildProcess(
      'terminal',
      TERMPACK_DIR,
      cacheDir,
      workDir,
    );
    if (outcome.kind !== 'built') throw new Error('build failed');
    const source = await readFile(outcome.scriptPath, 'utf8');
    const { registrations } = await evaluate(source);
    const meter = registrations[0]?.modules['meter'] as {
      component: (props: { attributes: Record<string, string> }) => unknown;
    };

    const g = globalThis as Record<string, unknown>;
    const created: unknown[][] = [];
    g['__markiiReactInk'] = {
      createElement: (...args: unknown[]) => {
        created.push(args);
        return { fake: true };
      },
      Fragment: Symbol('fragment'),
    };
    g['__markiiInk'] = { Text: 'InkText' };
    try {
      expect(meter.component({ attributes: { value: '0.5' } })).toEqual({
        fake: true,
      });
    } finally {
      delete g['__markiiReactInk'];
      delete g['__markiiInk'];
    }
    expect(created[0]?.[0]).toBe('InkText');
    expect(created[0]?.[2]).toBe('#####');
  });

  it('leaves the webview build of the same pack on the react sources only', async () => {
    const workDir = await makeTempDir();
    const cacheDir = await makeTempDir();
    const outcome = buildInChildProcess(
      'webview',
      TERMPACK_DIR,
      cacheDir,
      workDir,
    );
    expect(outcome.kind).toBe('built');
    if (outcome.kind !== 'built') return;
    const source = await readFile(outcome.scriptPath, 'utf8');
    expect(source).toContain('react only');
    expect(source).toContain('__markiiRegisterPack');
    expect(source).not.toContain('repeat(');
  });
});
