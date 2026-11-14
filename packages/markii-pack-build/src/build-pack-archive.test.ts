/**
 * `buildPackArchive` against real fixture packs. The build runs in a child
 * process for the reason `pack-build.fixture.test.ts` documents: esbuild-wasm
 * does not start inside Vitest's module realm.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cp, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { unzipSync } from 'fflate';
import { openPackArchive } from '@markii/pack';

const FIXTURES = path.resolve(import.meta.dirname, '../test-fixtures/packs');
const BUILD_PACK_ARCHIVE_TS = path.join(
  import.meta.dirname,
  'build-pack-archive.ts',
);

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), 'markii-build-archive-')),
  );
  tempDirs.push(dir);
  return dir;
}

async function packCopy(fixture: string): Promise<string> {
  const parent = await makeTempDir();
  const dir = path.join(parent, 'packs', fixture);
  await cp(path.join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}

interface Result {
  kind: 'built' | 'failed';
  reason?: string;
  fileName?: string;
  warnings?: string[];
  bytes?: Uint8Array;
}

async function build(
  folder: string,
  options: { cacheDir?: string } = {},
): Promise<Result> {
  const workDir = await makeTempDir();
  const driverPath = path.join(workDir, 'run-archive.cjs');
  writeFileSync(
    driverPath,
    `
    const { buildPackArchive } = require(${JSON.stringify(BUILD_PACK_ARCHIVE_TS)});
    (async () => {
      const outcome = await buildPackArchive(${JSON.stringify(folder)}, ${JSON.stringify(options)});
      const bytes = outcome.bytes ? Buffer.from(outcome.bytes).toString('base64') : undefined;
      process.stdout.write(JSON.stringify({ ...outcome, bytes }));
    })().catch((err) => {
      process.stdout.write(JSON.stringify({ kind: 'threw', reason: String(err && err.stack || err) }));
    });
  `,
    'utf8',
  );
  const { bytes, ...rest } = JSON.parse(
    execFileSync('node', ['--require', 'tsx/cjs', driverPath], {
      encoding: 'utf8',
      timeout: 90_000,
    }),
  ) as Omit<Result, 'bytes'> & { bytes?: string };
  return {
    ...rest,
    ...(bytes !== undefined
      ? { bytes: new Uint8Array(Buffer.from(bytes, 'base64')) }
      : {}),
  };
}

describe('buildPackArchive', () => {
  it('returns the bytes of a .mkp holding the compiled scripts, for a pack with terminal views', async () => {
    const dir = await packCopy('termpack');
    const cacheDir = await makeTempDir();
    const outcome = await build(dir, { cacheDir });
    expect(outcome.kind).toBe('built');
    expect(outcome.fileName).toMatch(/^termpack(-[^/]+)?\.mkp$/);
    expect(outcome.bytes).toBeDefined();
    const entries = Object.keys(unzipSync(outcome.bytes!)).sort();
    expect(entries).toContain('pack.json');
    expect(entries).toContain('webview.js');
    expect(entries).toContain('terminal.js');
    const opened = await openPackArchive(outcome.bytes!);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.archive.manifest.name).toBe('termpack');
  }, 90_000);

  it('is byte-identical when the same pack is built from two locations', async () => {
    const first = await packCopy('termpack');
    const second = await packCopy('termpack');
    const a = await build(first, { cacheDir: await makeTempDir() });
    const b = await build(second, { cacheDir: await makeTempDir() });
    expect(a.kind).toBe('built');
    expect(b.kind).toBe('built');
    expect(Buffer.from(a.bytes!).equals(Buffer.from(b.bytes!))).toBe(true);
  }, 180_000);

  it('never writes into the pack folder, and caches elsewhere', async () => {
    const dir = await packCopy('tsxpack');
    const before = (await readdir(dir, { recursive: true })).sort();
    const outcome = await build(dir, { cacheDir: await makeTempDir() });
    expect(outcome.kind).toBe('built');
    const after = (await readdir(dir, { recursive: true })).sort();
    expect(after).toEqual(before);
  }, 90_000);

  it('resolves failed, never throwing, for a folder that does not exist', async () => {
    const outcome = await build(path.join(await makeTempDir(), 'missing'));
    expect(outcome.kind).toBe('failed');
    expect(outcome.reason).toMatch(/no pack/);
  }, 30_000);

  it('resolves failed with the reason for a folder that holds no pack', async () => {
    const empty = await makeTempDir();
    const outcome = await build(empty, { cacheDir: await makeTempDir() });
    expect(outcome.kind).toBe('failed');
    expect(outcome.reason).toContain('no readable pack.json');
  }, 30_000);

  it('resolves failed when the folder holds more than one pack', async () => {
    const parent = await makeTempDir();
    await cp(path.join(FIXTURES, 'tsxpack'), path.join(parent, 'one'), {
      recursive: true,
    });
    await cp(path.join(FIXTURES, 'termpack'), path.join(parent, 'two'), {
      recursive: true,
    });
    const outcome = await build(parent, { cacheDir: await makeTempDir() });
    expect(outcome.kind).toBe('failed');
    expect(outcome.reason).toContain('holds 2 packs');
  }, 30_000);

  it('resolves failed, not thrown, when a component source cannot be compiled', async () => {
    const dir = await packCopy('tsxpack-barespecifier');
    const outcome = await build(dir, { cacheDir: await makeTempDir() });
    expect(outcome.kind).toBe('failed');
    expect(outcome.reason).toBeTruthy();
  }, 90_000);
});
