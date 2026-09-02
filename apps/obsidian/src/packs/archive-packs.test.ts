import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { openPackArchive } from '@markii/pack';
import {
  createNodeArchiveExtractFs,
  describeArchiveError,
  writeArchiveContents,
} from './archive-packs.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-obsidian-archive-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Builds a well-formed `.mkp` archive's bytes for a pack of `name`. */
function buildArchiveBytes(options: {
  name: string;
  withStylesheet?: boolean;
  withScript?: boolean;
}): Uint8Array {
  const manifest: Record<string, unknown> = {
    name: options.name,
    engine: 'react',
    components: { widget: './Widget.tsx' },
  };
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    'pack.json': encoder.encode(JSON.stringify(manifest)),
    'webview.js': encoder.encode('window.__markiiRegisterPack(() => ({}));'),
  };
  if (options.withStylesheet) {
    files['webview.css'] = encoder.encode(`.${options.name}_widget {}`);
  }
  if (options.withScript) {
    files['scripts/http.lua'] = encoder.encode('return {}');
  }
  return zipSync(files);
}

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

describe('writeArchiveContents / createNodeArchiveExtractFs', () => {
  it('writes pack.json, webview.js, webview.css, and scripts/* into the destination directory', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'ana.mkp');
    await writeFile(
      archivePath,
      buildArchiveBytes({
        name: 'ana',
        withStylesheet: true,
        withScript: true,
      }),
    );
    const archiveBytes = new Uint8Array(await readFile(archivePath));
    const opened = await openPackArchive(archiveBytes);
    if (!opened.ok) throw new Error('expected a valid archive');

    const destination = path.join(workDir, 'installed', 'ana');
    await writeArchiveContents(
      opened.archive,
      destination,
      createNodeArchiveExtractFs(),
    );

    const manifest = JSON.parse(
      await readFile(path.join(destination, 'pack.json'), 'utf8'),
    ) as { name: string };
    expect(manifest.name).toBe('ana');
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
});
