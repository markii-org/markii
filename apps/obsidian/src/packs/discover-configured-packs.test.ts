import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
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
    const packs = await discoverConfiguredPacks([]);
    expect(packs).toEqual([]);
  });

  it('never throws for a folder that does not exist', async () => {
    await expect(
      discoverConfiguredPacks(['/definitely/not/a/real/pack/folder']),
    ).resolves.toEqual([]);
  });

  it('discovers a real installed pack folder', async () => {
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

    const packs = await discoverConfiguredPacks([packDir]);
    expect(packs.map((p) => p.manifest.name)).toEqual(['demo']);
  });
});
