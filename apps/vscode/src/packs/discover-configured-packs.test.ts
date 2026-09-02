import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { discoverConfiguredPacks } from './discover-configured-packs.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-discover-configured-'));
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

  it('omits bundled packs when extensionPath is not given (the export command)', async () => {
    const packs = await discoverConfiguredPacks([], undefined);
    expect(packs).toEqual([]);
  });

  describe('with extensionPath (Insert Component / completion)', () => {
    async function makeBundledPack(
      extensionPath: string,
      name: string,
    ): Promise<void> {
      const packDir = path.join(extensionPath, 'dist', 'packs', name);
      await mkdir(packDir, { recursive: true });
      await writeFile(
        path.join(packDir, 'pack.json'),
        JSON.stringify({
          name,
          engine: 'react',
          components: { widget: './Widget.tsx' },
        }),
      );
    }

    it('includes a bundled pack even with no markii.packs configured', async () => {
      const extensionPath = await makeTempDir();
      await makeBundledPack(extensionPath, 'read');

      const packs = await discoverConfiguredPacks([], undefined, extensionPath);

      expect(packs.map((pack) => pack.manifest.name)).toEqual(['read']);
    });

    it('orders the bundled pack ahead of a configured one', async () => {
      const extensionPath = await makeTempDir();
      await makeBundledPack(extensionPath, 'read');
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

      const packs = await discoverConfiguredPacks(
        ['demo'],
        root,
        extensionPath,
      );

      expect(packs.map((pack) => pack.manifest.name)).toEqual(['read', 'demo']);
    });

    it('drops a configured pack claiming a bundled namespace, bundled wins', async () => {
      const extensionPath = await makeTempDir();
      await makeBundledPack(extensionPath, 'read');
      const root = await makeTempDir();
      const packDir = path.join(root, 'my-read');
      await mkdir(packDir, { recursive: true });
      await writeFile(
        path.join(packDir, 'pack.json'),
        JSON.stringify({
          name: 'read',
          engine: 'react',
          components: { widget: './Widget.tsx' },
        }),
      );

      const packs = await discoverConfiguredPacks(
        ['my-read'],
        root,
        extensionPath,
      );

      expect(packs).toHaveLength(1);
      expect(packs[0]!.folder).toBe(
        path.join(extensionPath, 'dist', 'packs', 'read'),
      );
    });
  });
});
