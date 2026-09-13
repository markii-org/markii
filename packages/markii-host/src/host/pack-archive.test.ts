import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { openPackArchive } from '@markii/pack';
import {
  createNodeArchiveExtractFs,
  describeArchiveError,
  writeArchiveContents,
} from './pack-archive.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-host-archive-packs-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('describeArchiveError', () => {
  it('summarizes a manifest failure plainly', async () => {
    const opened = await openPackArchive(
      zipSync({
        'pack.json': new TextEncoder().encode('not json'),
        'webview.js': new TextEncoder().encode('1'),
      }),
    );
    if (opened.ok) throw new Error('expected an invalid archive');
    expect(describeArchiveError(opened.error)).toContain('invalid pack.json');
  });
});

describe('writeArchiveContents + createNodeArchiveExtractFs', () => {
  it('writes pack.json, webview.js, webview.css and nested scripts/ modules', async () => {
    const workDir = await makeTempDir();
    const target = path.join(workDir, 'out');
    const fs = createNodeArchiveExtractFs();

    await writeArchiveContents(
      {
        manifest: { name: 'ana', engine: 'react', components: {} },
        manifestWarnings: [],
        scriptBytes: new TextEncoder().encode('script'),
        stylesheetBytes: new TextEncoder().encode('style'),
        scriptModules: {
          'http.lua': new TextEncoder().encode('return {}'),
          'nested/sub.lua': new TextEncoder().encode('return 1'),
        },
        ignoredEntries: [],
      },
      target,
      fs,
    );

    expect(await readFile(path.join(target, 'pack.json'), 'utf8')).toContain(
      '"ana"',
    );
    expect(await readFile(path.join(target, 'webview.js'), 'utf8')).toBe(
      'script',
    );
    expect(await readFile(path.join(target, 'webview.css'), 'utf8')).toBe(
      'style',
    );
    expect(
      await readFile(path.join(target, 'scripts', 'http.lua'), 'utf8'),
    ).toBe('return {}');
    expect(
      await readFile(path.join(target, 'scripts', 'nested', 'sub.lua'), 'utf8'),
    ).toBe('return 1');
  });

  it('round-trips a real .mkp archive through openPackArchive', async () => {
    const workDir = await makeTempDir();
    const manifest = {
      name: 'ana',
      engine: 'react',
      components: { widget: './Widget.tsx' },
    };
    const encoder = new TextEncoder();
    const archiveBytes = zipSync({
      'pack.json': encoder.encode(JSON.stringify(manifest)),
      'webview.js': encoder.encode('window.__markiiRegisterPack(() => ({}));'),
      'webview.css': encoder.encode('.ana_widget {}'),
      'scripts/http.lua': encoder.encode('return {}'),
    });
    const opened = await openPackArchive(archiveBytes);
    if (!opened.ok) throw new Error('expected a valid archive');

    const destination = path.join(workDir, 'installed', 'ana');
    await writeArchiveContents(
      opened.archive,
      destination,
      createNodeArchiveExtractFs(),
    );

    const written = JSON.parse(
      await readFile(path.join(destination, 'pack.json'), 'utf8'),
    ) as { name: string };
    expect(written.name).toBe('ana');
    await expect(
      readFile(path.join(destination, 'webview.js'), 'utf8'),
    ).resolves.toContain('__markiiRegisterPack');
    await expect(
      readFile(path.join(destination, 'webview.css'), 'utf8'),
    ).resolves.toBe('.ana_widget {}');
    await expect(
      readFile(path.join(destination, 'scripts', 'http.lua'), 'utf8'),
    ).resolves.toBe('return {}');
  });

  it('removeDirectory never rejects, even for a path that does not exist', async () => {
    const workDir = await makeTempDir();
    const fs = createNodeArchiveExtractFs();
    await expect(
      fs.removeDirectory(path.join(workDir, 'does-not-exist')),
    ).resolves.toBeUndefined();
  });
});
