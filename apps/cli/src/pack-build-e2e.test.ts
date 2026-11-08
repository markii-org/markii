/**
 * The whole terminal-pack path with nothing hand-written: a real source
 * pack (`@markii/host`'s `termpack` fixture, JSX over `ink`, shared logic in
 * a plain module) is compiled by the real esbuild-wasm builder into
 * `terminal.js`, installed into the CLI's store, and rendered by the real
 * terminal engine through `markii view`.
 *
 * The compile runs in a child process because esbuild-wasm's startup check
 * fails inside Vitest's module realm (see the host's
 * `pack-build.fixture.test.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { run } from './main.js';
import { packStoreDirectory } from './pack-store.js';
import { createFakeTerminal } from './test-terminal.js';

const FIXTURE = path.resolve(
  import.meta.dirname,
  '../../../packages/markii-host/test-fixtures/packs/termpack',
);
const PACK_BUILD_TS = path.resolve(
  import.meta.dirname,
  '../../../packages/markii-host/src/packs/pack-build.ts',
);

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'markii-cli-e2e-'));
  tempDirs.push(dir);
  return dir;
}

function buildTerminalScript(workDir: string, cacheDir: string): string {
  const driver = path.join(workDir, 'build.cjs');
  writeFileSync(
    driver,
    `
    const fs = require('node:fs');
    const path = require('node:path');
    const { buildPackTerminalScript } = require(${JSON.stringify(PACK_BUILD_TS)});
    (async () => {
      const dir = ${JSON.stringify(FIXTURE)};
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8'));
      const ansi = { meter: path.join(dir, 'Meter.ansi.tsx') };
      const pack = { folder: dir, manifest, componentPaths: {}, componentPathsByEngine: { ansi } };
      process.stdout.write(JSON.stringify(await buildPackTerminalScript(pack, ${JSON.stringify(cacheDir)})));
    })().catch((e) => process.stdout.write(JSON.stringify({ kind: 'failed', reason: String(e) })));
  `,
  );
  const outcome = JSON.parse(
    execFileSync('node', ['--require', 'tsx/cjs', driver], {
      encoding: 'utf8',
      timeout: 30_000,
    }),
  ) as { kind: string; scriptPath?: string; reason?: string };
  if (outcome.kind !== 'built' || outcome.scriptPath === undefined) {
    throw new Error(`terminal build failed: ${outcome.reason ?? outcome.kind}`);
  }
  return outcome.scriptPath;
}

describe('a pack built from source, installed, and viewed', () => {
  it('renders its Ink view through markii view, sharing logic with the React view', async () => {
    const home = temp();
    const env = {
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      XDG_CONFIG_HOME: home,
    };
    const folder = path.join(
      packStoreDirectory(env, process.platform),
      'termpack',
    );
    mkdirSync(folder, { recursive: true });
    copyFileSync(
      path.join(FIXTURE, 'pack.json'),
      path.join(folder, 'pack.json'),
    );
    const script = buildTerminalScript(temp(), temp());
    writeFileSync(path.join(folder, 'terminal.js'), readFileSync(script));

    const dir = temp();
    const note = path.join(dir, 'note.mk.md');
    writeFileSync(
      note,
      '::termpack_meter{value="0.5"}\n::\n::termpack_reactonly\n::\n',
    );
    const terminal = createFakeTerminal({ env });

    expect(
      await run(['view', note, '--static', '--color', 'never'], terminal),
    ).toBe(0);
    const out = terminal.outLines.join('');
    // The terminal view ran (value 0.5 of 10 cells) ...
    expect(out).toContain('#####');
    // ... and the component with no terminal source is the quiet fallback.
    expect(out).toContain('unknown component');
    expect(terminal.errLines).toEqual([]);
  });
});
