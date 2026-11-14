/**
 * Real esbuild-wasm builds of one pack from two different absolute
 * locations: the compiled output must carry the manifest text unchanged and
 * no build-machine path, so an archive is the same on every machine.
 * The build runs in a child process for the reason
 * `pack-build.fixture.test.ts` documents.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { PackBuildOutcome } from './pack-build.js';

const FIXTURES = path.resolve(import.meta.dirname, '../test-fixtures/packs');
const PACK_BUILD_TS = path.join(import.meta.dirname, 'pack-build.ts');

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), 'markii-portable-')),
  );
  tempDirs.push(dir);
  return dir;
}

/** The termpack fixture with a pack.json whose text differs from `JSON.stringify(JSON.parse(text))`. */
const RAW_MANIFEST = `{
    "components": {
      "reactonly": "./ReactOnly.tsx",
      "meter": {
        "attributes": [],
        "sources": { "react": "./Meter.tsx", "ansi": "./Meter.ansi.tsx" }
      }
    },
      "engine": "react",
  "name": "termpack"
}
`;

async function packCopy(fixture: string, manifest?: string): Promise<string> {
  const parent = await makeTempDir();
  const dir = path.join(parent, 'packs', fixture);
  await cp(path.join(FIXTURES, fixture), dir, { recursive: true });
  if (manifest !== undefined) {
    await writeFile(path.join(dir, 'pack.json'), manifest, 'utf8');
  }
  return dir;
}

function build(
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
  const source = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { ${fn} } = require(${JSON.stringify(PACK_BUILD_TS)});
    (async () => {
      const packDir = ${JSON.stringify(packDir)};
      const manifestText = fs.readFileSync(path.join(packDir, 'pack.json'), 'utf8');
      const manifest = JSON.parse(manifestText);
      const react = {};
      const ansi = {};
      for (const [name, entry] of Object.entries(manifest.components)) {
        if (typeof entry === 'string') react[name] = path.join(packDir, entry);
        else {
          const sources = entry.sources || { react: entry.source };
          if (sources.react) react[name] = path.join(packDir, sources.react);
          if (sources.ansi) ansi[name] = path.join(packDir, sources.ansi);
        }
      }
      const pack = { folder: packDir, manifest, manifestText, componentPaths: react, componentPathsByEngine: { react, ansi } };
      process.stdout.write(JSON.stringify(await ${fn}(pack, ${JSON.stringify(cacheDir)})));
    })().catch((err) => {
      process.stdout.write(JSON.stringify({ kind: 'failed', reason: String(err && err.stack || err) }));
    });
  `;
  writeFileSync(driverPath, source, 'utf8');
  return JSON.parse(
    execFileSync('node', ['--require', 'tsx/cjs', driverPath], {
      encoding: 'utf8',
      timeout: 60_000,
    }),
  ) as PackBuildOutcome;
}

async function builtTexts(
  kind: 'terminal' | 'webview',
  packDir: string,
): Promise<{ script: string; style?: string }> {
  const workDir = await makeTempDir();
  const cacheDir = await makeTempDir();
  await writeFile(path.join(workDir, 'placeholder'), '', 'utf8');
  const outcome = build(kind, packDir, cacheDir, workDir);
  if (outcome.kind !== 'built') {
    throw new Error(`build did not succeed: ${JSON.stringify(outcome)}`);
  }
  return {
    script: await readFile(outcome.scriptPath, 'utf8'),
    ...(outcome.stylesheetPath !== undefined
      ? { style: await readFile(outcome.stylesheetPath, 'utf8') }
      : {}),
  };
}

/** The manifest string a compiled script hands to its registration call, read by evaluating the string literal esbuild emitted. */
function registeredManifest(script: string): string {
  const match =
    /__markiiRegister(?:Terminal)?Pack\((.*), __markiiEntries\);/.exec(script);
  if (!match?.[1]) throw new Error('no registration call in the script');
  return new Function(`return ${match[1]};`)() as string;
}

describe('compiled pack output is portable', () => {
  it('registers the pack.json text byte for byte, in both scripts', async () => {
    const dir = await packCopy('termpack', RAW_MANIFEST);
    expect(JSON.stringify(JSON.parse(RAW_MANIFEST))).not.toBe(RAW_MANIFEST);
    const web = await builtTexts('webview', dir);
    const terminal = await builtTexts('terminal', dir);
    expect(registeredManifest(web.script)).toBe(RAW_MANIFEST);
    expect(registeredManifest(terminal.script)).toBe(RAW_MANIFEST);
  });

  it('names no build directory, and is identical from two locations', async () => {
    const first = await packCopy('termpack', RAW_MANIFEST);
    const second = await packCopy('termpack', RAW_MANIFEST);
    for (const kind of ['webview', 'terminal'] as const) {
      const a = await builtTexts(kind, first);
      const b = await builtTexts(kind, second);
      expect(a.script).toBe(b.script);
      for (const text of [a.script, b.script]) {
        expect(text).not.toContain(path.dirname(path.dirname(first)));
        expect(text).not.toContain(path.dirname(path.dirname(second)));
      }
    }
  });

  it('keeps helper modules and a stylesheet portable too', async () => {
    const first = await packCopy('tsxpack-helpers');
    const second = await packCopy('tsxpack-helpers');
    const a = await builtTexts('webview', first);
    const b = await builtTexts('webview', second);
    expect(a.style).toBeDefined();
    expect(a.script).toBe(b.script);
    expect(a.style).toBe(b.style);
    for (const text of [a.script, a.style ?? '']) {
      expect(text).not.toContain(path.dirname(path.dirname(first)));
    }
  });
});
