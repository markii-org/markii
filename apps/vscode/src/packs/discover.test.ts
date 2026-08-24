import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { discoverPacks, installedNamespaces } from './discover.js';
import type { PackFileReader } from './discover.js';

const VALID_MANIFEST = JSON.stringify({
  name: 'demo',
  engine: 'react',
  components: { widget: './Widget.tsx' },
});

function readerFor(files: Record<string, string>): PackFileReader {
  return async (absolutePath) => files[absolutePath];
}

describe('discoverPacks', () => {
  it('discovers a valid pack and resolves component/script paths', async () => {
    const folder = '/packs/demo';
    const reader = readerFor({
      [path.join(folder, 'pack.json')]: VALID_MANIFEST,
    });

    const result = await discoverPacks([folder], reader);

    expect(result.collisions).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.packs).toHaveLength(1);
    const pack = result.packs[0]!;
    expect(pack.manifest.name).toBe('demo');
    expect(pack.componentPaths.widget).toBe(path.join(folder, 'Widget.tsx'));
    expect(pack.scriptsDir).toBe(path.join(folder, 'scripts'));
    expect(pack.webviewScriptPath).toBe(path.join(folder, 'webview.js'));
    expect(installedNamespaces(result.packs)).toEqual(['demo']);
  });

  it('quietly skips a folder with no pack.json', async () => {
    const reader = readerFor({});
    const result = await discoverPacks(['/packs/missing'], reader);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toEqual([
      { folder: '/packs/missing', reason: 'no readable pack.json' },
    ]);
  });

  it('quietly skips a folder with malformed pack.json', async () => {
    const folder = '/packs/bad';
    const reader = readerFor({
      [path.join(folder, 'pack.json')]: '{not json',
    });
    const result = await discoverPacks([folder], reader);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.folder).toBe(folder);
  });

  it('quietly skips a folder whose manifest fails validation', async () => {
    const folder = '/packs/invalid';
    const reader = readerFor({
      [path.join(folder, 'pack.json')]: JSON.stringify({ name: 'demo' }),
    });
    const result = await discoverPacks([folder], reader);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it('rejects both packs sharing a namespace and reports the collision', async () => {
    const folderA = '/packs/a';
    const folderB = '/packs/b';
    const reader = readerFor({
      [path.join(folderA, 'pack.json')]: VALID_MANIFEST,
      [path.join(folderB, 'pack.json')]: VALID_MANIFEST,
    });

    const result = await discoverPacks([folderA, folderB], reader);

    expect(result.packs).toEqual([]);
    expect(result.collisions).toEqual(['demo']);
    expect(result.skipped).toHaveLength(2);
  });

  it('de-duplicates repeated folder entries without manufacturing a collision', async () => {
    const folder = '/packs/demo';
    const reader = readerFor({
      [path.join(folder, 'pack.json')]: VALID_MANIFEST,
    });

    const result = await discoverPacks([folder, folder], reader);

    expect(result.packs).toHaveLength(1);
    expect(result.collisions).toEqual([]);
  });

  it('never throws when the reader itself rejects', async () => {
    const reader: PackFileReader = async () => {
      throw new Error('boom');
    };
    const result = await discoverPacks(['/packs/x'], reader);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });
});
