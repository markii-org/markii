import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverFoldersViaHost } from './host-discovery.js';

async function writePack(
  root: string,
  name: string,
  components: unknown,
): Promise<string> {
  const folder = path.join(root, name);
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, 'pack.json'),
    JSON.stringify({ name, engine: 'react', components }),
  );
  return folder;
}

describe('discoverFoldersViaHost', () => {
  it('finds a pack folder through the shared host', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'markii-discovery-'));
    const folder = await writePack(root, 'demo', { w: './W.tsx' });
    const result = await discoverFoldersViaHost([folder]);
    expect(result.packs.map((pack) => pack.manifest.name)).toEqual(['demo']);
    expect(result.skipped).toEqual([]);
  });

  it('reports a folder with no pack.json as skipped, never a throw', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'markii-discovery-'));
    const result = await discoverFoldersViaHost([path.join(root, 'missing')]);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it('keeps a pack with nothing for the preview engine out of the packs, with its components listed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'markii-discovery-'));
    const folder = await writePack(root, 'term', {
      t: { sources: { ansi: './t.ts' } },
    });
    const result = await discoverFoldersViaHost([folder]);
    expect(result.packs).toEqual([]);
    expect(result.components).toEqual([
      expect.objectContaining({ pack: 'term', engines: ['ansi'] }),
    ]);
  });
});
