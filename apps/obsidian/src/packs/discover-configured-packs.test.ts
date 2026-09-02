import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { discoverConfiguredPacks } from './discover-configured-packs.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(
    path.join(tmpdir(), 'markii-obsidian-discover-configured-'),
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('discoverConfiguredPacks', () => {
  it('resolves an empty list to no packs, without touching the filesystem', async () => {
    const packs = await discoverConfiguredPacks([], undefined);
    expect(packs).toEqual([]);
  });

  it('never throws for a folder that does not exist', async () => {
    await expect(
      discoverConfiguredPacks(['/definitely/not/a/real/pack/folder'], '/tmp'),
    ).resolves.toEqual([]);
  });

  it('includes a .mkp archive entry alongside a folder pack, manifest-only', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'demo');
    await mkdir(packDir, { recursive: true });
    await writeFile(
      path.join(packDir, 'pack.json'),
      JSON.stringify({
        name: 'demo',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    );

    const encoder = new TextEncoder();
    const archivePath = path.join(root, 'ana.mkp');
    await writeFile(
      archivePath,
      zipSync({
        'pack.json': encoder.encode(
          JSON.stringify({
            name: 'ana',
            engine: 'react',
            components: { widget: './Widget.tsx' },
          }),
        ),
        'webview.js': encoder.encode(
          'window.__markiiRegisterPack(() => ({}));',
        ),
      }),
    );

    const packs = await discoverConfiguredPacks(['demo', 'ana.mkp'], root);
    expect(packs.map((p) => p.manifest.name).sort()).toEqual(['ana', 'demo']);
  });

  it('silently excludes an invalid .mkp entry rather than throwing', async () => {
    const root = await makeTempDir();
    const archivePath = path.join(root, 'bad.mkp');
    await writeFile(archivePath, new TextEncoder().encode('not a zip'));

    await expect(discoverConfiguredPacks(['bad.mkp'], root)).resolves.toEqual(
      [],
    );
  });
});
