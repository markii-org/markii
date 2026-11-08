/**
 * The bundled packs' terminal views, end to end: the real packs under
 * `packs/` are compiled by the real builder (the one `markii`'s own build
 * runs) into `terminal.js`, loaded through the engine's real pack loader,
 * and each pack's `example.mk.md` is rendered by the real terminal engine
 * against the values the note's own scripts produce (real Lua).
 *
 * The output is checked against committed fixtures in `apps/cli/test-fixtures/bundled-packs/`
 * at width 80, color never, in both box styles. Run with
 * `UPDATE_PACK_FIXTURES=1` to rewrite them after an intended change.
 *
 * The compile runs in a child process because esbuild-wasm's startup check
 * fails inside Vitest's module realm (see `pack-build-e2e.test.ts`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  defaultAnsiRegistry,
  installAnsiPacks,
  loadTerminalPackScript,
  renderMarkToAnsi,
  type AnsiPackToInstall,
  type AnsiRegistry,
} from '@markii/ansi';
import { extractScripts, parse } from '@markii/core';
import { createLuaExecutor } from '@markii/lua';
import { parsePackManifest } from '@markii/pack';
import {
  buildDirectiveListing,
  createValueStore,
  runDocumentScripts,
  type DocumentTreeNode,
  type ValueStore,
} from '@markii/runtime';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const BUILDER = path.join(
  REPO_ROOT,
  'apps/cli/src/packs/build-bundled-packs.ts',
);
const FIXTURE_DIR = path.join(
  REPO_ROOT,
  'apps/cli/test-fixtures/bundled-packs',
);
const PACKS = ['read', 'dash', 'prep'] as const;
const UPDATE = process.env.UPDATE_PACK_FIXTURES === '1';

let workDir = '';
let outDir = '';
let registry: AnsiRegistry = defaultAnsiRegistry;

function buildBundledPacksInChild(out: string, cache: string): void {
  const driver = path.join(workDir, 'build.cjs');
  writeFileSync(
    driver,
    `
    const { buildBundledPacks } = require(${JSON.stringify(BUILDER)});
    buildBundledPacks({
      repoRoot: ${JSON.stringify(REPO_ROOT)},
      outDir: ${JSON.stringify(out)},
      cacheDir: ${JSON.stringify(cache)},
    }).then(
      (built) => process.stdout.write(JSON.stringify({ built })),
      (e) => process.stdout.write(JSON.stringify({ failed: String(e) })),
    );
  `,
  );
  const outcome = JSON.parse(
    execFileSync('node', ['--require', 'tsx/cjs', driver], {
      encoding: 'utf8',
      timeout: 120_000,
    }),
  ) as { built?: string[]; failed?: string };
  if (outcome.failed !== undefined) {
    throw new Error(`bundled pack build failed: ${outcome.failed}`);
  }
  expect(outcome.built).toEqual([...PACKS]);
}

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), 'markii-bundled-packs-'));
  outDir = path.join(workDir, 'packs');
  buildBundledPacksInChild(outDir, path.join(workDir, 'cache'));

  const toInstall: AnsiPackToInstall[] = [];
  for (const name of PACKS) {
    const folder = path.join(outDir, name);
    const manifest = parsePackManifest(
      readFileSync(path.join(folder, 'pack.json'), 'utf8'),
    );
    if (!manifest.ok) throw new Error(`${name}: ${manifest.errors.join('; ')}`);
    const loaded = await loadTerminalPackScript(
      readFileSync(path.join(folder, 'terminal.js'), 'utf8'),
    );
    if (!loaded.ok) throw new Error(`${name}: ${loaded.reason}`);
    toInstall.push({
      manifest: manifest.manifest,
      componentModules: loaded.pack.componentModules,
    });
  }
  const installed = installAnsiPacks(toInstall, defaultAnsiRegistry);
  if (!installed.ok) throw new Error('bundled packs collide');
  expect(installed.dropped).toEqual([]);
  registry = installed.registry;
}, 150_000);

afterAll(() => {
  if (workDir !== '') rmSync(workDir, { recursive: true, force: true });
});

/** Runs the note's own scripts (real Lua, manual tier) into a fresh store. */
async function runNoteScripts(text: string): Promise<ValueStore> {
  const tree = parse(text);
  const store = createValueStore();
  const summary = await runDocumentScripts({
    scripts: extractScripts(tree),
    executor: createLuaExecutor(),
    trigger: 'manual',
    store,
    doc: { directives: buildDirectiveListing(tree as DocumentTreeNode) },
  });
  expect(summary.errorCount).toBe(0);
  return store;
}

function expectFixture(file: string, actual: string): void {
  const target = path.join(FIXTURE_DIR, file);
  if (UPDATE) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(target, actual, 'utf8');
  }
  expect(existsSync(target), `${file} is missing`).toBe(true);
  expect(actual).toBe(readFileSync(target, 'utf8'));
}

describe('bundled packs render in the terminal', () => {
  for (const name of PACKS) {
    describe(name, () => {
      const note = (): string =>
        readFileSync(
          path.join(REPO_ROOT, 'packs', name, 'example.mk.md'),
          'utf8',
        );

      it('draws every component of its example (none falls back to unknown)', async () => {
        const text = note();
        const store = await runNoteScripts(text);
        const out = await renderMarkToAnsi(text, registry, store, undefined, {
          width: 80,
          color: 'never',
        });
        expect(out).not.toContain('unknown component');
        expectFixture(`${name}.txt`, `${out}\n`);
      });

      it('matches the ascii-box fixture, and that fixture is 7-bit', async () => {
        const text = note();
        const store = await runNoteScripts(text);
        const out = await renderMarkToAnsi(text, registry, store, undefined, {
          width: 80,
          color: 'never',
          box: 'ascii',
        });
        expectFixture(`${name}.ascii.txt`, `${out}\n`);
        // Anything above 0x7f here came from the note itself (its own
        // prose), never from a pack glyph: strip the note's text first.
        const noteChars = new Set(text);
        const foreign = [...out].filter(
          (ch) => ch.charCodeAt(0) > 0x7f && !noteChars.has(ch),
        );
        expect(foreign).toEqual([]);
      });

      it('colors only through SGR when color is on', async () => {
        const text = note();
        const store = await runNoteScripts(text);
        const out = await renderMarkToAnsi(text, registry, store, undefined, {
          width: 80,
          color: 'truecolor',
        });
        expect(out).toMatch(/\x1b\[/);
        const withoutSgr = out.replace(/\x1b\[[0-9;]*m/g, '');
        expect(withoutSgr).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
      });
    });
  }

  it('shows a failed and a stale binding as the quiet marker, never as an error dump', async () => {
    const store = createValueStore();
    store.set('series', {
      value: undefined,
      status: 'error',
      error: 'boom',
      failureKind: 'script-error',
    });
    store.set('level', { value: 40, status: 'stale' });
    const out = await renderMarkToAnsi(
      [
        '::dash_sparkline{data=series label="CPU"}',
        '',
        '::dash_gauge{data=level label="Mem" unit="%"}',
        '',
        '::read_source{title="T" data=series}',
        '',
        '::prep_quiz{data=series}',
      ].join('\n'),
      registry,
      store,
      undefined,
      { width: 80, color: 'never' },
    );
    expect(out).toContain('(script error)');
    expect(out).toContain('(stale)');
    expect(out).not.toContain('boom');
    expect(out).not.toContain('unknown component');
  });

  it('keeps hostile attribute text from reaching the output as a control character', async () => {
    const out = await renderMarkToAnsi(
      [
        '::dash_gauge{value=5 label="a\u001b]0;pwn\u0007b" unit="\u001b[31m"}',
        '',
        '::read_source{title="x\u001b[2Jy" author="\u009bz"}',
        '',
        ':::prep_pitfall{title="\u001b[H"}',
        'body',
        ':::',
      ].join('\n'),
      registry,
      undefined,
      undefined,
      { width: 80, color: 'never' },
    );
    expect(out).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f\x80-\x9f]/);
  });
});
