import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  addPackFolderDiagnosticLines,
  addedPackFolderMessage,
  unusablePackFolderMessage,
  validatePackFolder,
} from './validate-pack-folder.js';
import type { DiscoveredPack } from '@markii/host';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(
    path.join(tmpdir(), 'markii-validate-pack-folder-'),
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('validatePackFolder (batch 7 #61)', () => {
  it('finds a valid react-engine pack directly in the folder', async () => {
    const folder = await makeTempDir();
    await writeFile(
      path.join(folder, 'pack.json'),
      JSON.stringify({
        name: 'demo',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    );

    const result = await validatePackFolder(folder);
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]?.manifest.name).toBe('demo');
    expect(result.skipped).toEqual([]);
  });

  it('reports no packs and a reason when the folder has no pack.json at all', async () => {
    const folder = await makeTempDir();

    const result = await validatePackFolder(folder);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('no readable pack.json');
  });

  it('reports no packs and a reason when pack.json is malformed', async () => {
    const folder = await makeTempDir();
    await writeFile(path.join(folder, 'pack.json'), '{not json');

    const result = await validatePackFolder(folder);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('invalid pack.json');
  });

  it('reports no packs and an engine-specific reason for a pack this renderer cannot run', async () => {
    const folder = await makeTempDir();
    await writeFile(
      path.join(folder, 'pack.json'),
      JSON.stringify({
        name: 'vega',
        engine: 'vue',
        components: { chart: './Chart.vue' },
      }),
    );

    const result = await validatePackFolder(folder);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('vue');
    expect(result.skipped[0]?.reason).toContain('react');
  });

  it('finds every valid pack one level below a parent folder (the folder-of-packs case)', async () => {
    const parent = await makeTempDir();
    await mkdir(path.join(parent, 'a'));
    await mkdir(path.join(parent, 'b'));
    await writeFile(
      path.join(parent, 'a', 'pack.json'),
      JSON.stringify({ name: 'a', engine: 'react', components: {} }),
    );
    await writeFile(
      path.join(parent, 'b', 'pack.json'),
      JSON.stringify({ name: 'b', engine: 'react', components: {} }),
    );

    const result = await validatePackFolder(parent);
    expect(result.packs.map((pack) => pack.manifest.name).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('never throws for a folder that does not exist on disk', async () => {
    await expect(
      validatePackFolder('/definitely/not/a/real/pack/folder'),
    ).resolves.toEqual({ packs: [], skipped: expect.any(Array) });
  });
});

describe('add pack folder wording', () => {
  const pack = {
    folder: '/packs/read',
    manifest: {
      name: 'read',
      version: '1.0.0',
      engine: 'react',
      components: {},
    },
    componentPaths: {},
    scriptsDir: '/packs/read/scripts',
  } as unknown as DiscoveredPack;

  it('names what a added folder provides', () => {
    expect(addedPackFolderMessage({ packs: [pack], skipped: [] })).toBe(
      'Markii: pack folder added. It provides read.',
    );
  });

  it('sends an unusable folder to the output channel, not to the notice', () => {
    const message = unusablePackFolderMessage('/tmp/not-a-pack');
    expect(message).toContain('holds no usable pack');
    expect(message).toContain('Open the Markii output');
  });

  it('reports every skipped folder with its reason', () => {
    const lines = addPackFolderDiagnosticLines(
      {
        packs: [],
        skipped: [{ folder: '/tmp/x', reason: 'no readable pack.json' }],
      },
      '/tmp/x',
    );
    expect(lines).toEqual([
      'Add Pack Folder: skipped /tmp/x: no readable pack.json.',
    ]);
  });
});
