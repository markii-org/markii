import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { discoverPacks, installedNamespaces } from './discover.js';
import type { PackDirectoryLister, PackFileReader } from './discover.js';

const VALID_MANIFEST = JSON.stringify({
  name: 'demo',
  engine: 'react',
  components: { widget: './Widget.tsx' },
});

function readerFor(files: Record<string, string>): PackFileReader {
  return async (absolutePath) => files[absolutePath];
}

/** An in-memory `PackDirectoryLister`: `entries` maps an absolute directory path to its immediate children. */
function listerFor(
  entries: Record<
    string,
    ReadonlyArray<{ name: string; isDirectory: boolean }>
  >,
): PackDirectoryLister {
  return async (absoluteDir) => entries[absoluteDir] ?? [];
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

describe('discoverPacks — one-level parent-folder scan', () => {
  it('discovers a pack in an immediate subfolder when the parent has no pack.json of its own', async () => {
    const parent = '/packs';
    const child = '/packs/pack1';
    const reader = readerFor({
      [path.join(child, 'pack.json')]: VALID_MANIFEST,
    });
    const lister = listerFor({
      [parent]: [{ name: 'pack1', isDirectory: true }],
    });

    const result = await discoverPacks([parent], reader, lister);

    expect(result.skipped).toEqual([]);
    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]!.folder).toBe(child);
    expect(installedNamespaces(result.packs)).toEqual(['demo']);
  });

  it('discovers several packs under one configured parent folder', async () => {
    const parent = '/packs';
    const readerFiles: Record<string, string> = {
      [path.join(parent, 'pack1', 'pack.json')]: JSON.stringify({
        name: 'one',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
      [path.join(parent, 'pack2', 'pack.json')]: JSON.stringify({
        name: 'two',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    };
    const lister = listerFor({
      [parent]: [
        { name: 'pack1', isDirectory: true },
        { name: 'pack2', isDirectory: true },
      ],
    });

    const result = await discoverPacks(
      [parent],
      readerFor(readerFiles),
      lister,
    );

    expect(result.packs).toHaveLength(2);
    expect(installedNamespaces(result.packs).sort()).toEqual(['one', 'two']);
  });

  it('does NOT scan when the parent folder has its own pack.json, even if it also has subfolders', async () => {
    const parent = '/packs/demo';
    const reader = readerFor({
      [path.join(parent, 'pack.json')]: VALID_MANIFEST,
      // A subfolder that would ALSO look like a pack — must be ignored,
      // since the parent's own manifest already answered discovery.
      [path.join(parent, 'nested', 'pack.json')]: JSON.stringify({
        name: 'nested',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    });
    const lister = listerFor({
      [parent]: [{ name: 'nested', isDirectory: true }],
    });

    const result = await discoverPacks([parent], reader, lister);

    expect(result.packs).toHaveLength(1);
    expect(result.packs[0]!.folder).toBe(parent);
    expect(installedNamespaces(result.packs)).toEqual(['demo']);
  });

  it('is exactly one level deep: a grandchild pack.json is never found', async () => {
    const parent = '/packs';
    const reader = readerFor({
      [path.join(parent, 'a', 'b', 'pack.json')]: VALID_MANIFEST,
    });
    const lister = listerFor({
      [parent]: [{ name: 'a', isDirectory: true }],
      [path.join(parent, 'a')]: [{ name: 'b', isDirectory: true }],
    });

    const result = await discoverPacks([parent], reader, lister);

    expect(result.packs).toEqual([]);
    expect(result.skipped).toEqual([
      { folder: parent, reason: 'no readable pack.json' },
    ]);
  });

  it('skips a non-directory sibling entry without probing it as a pack folder', async () => {
    const parent = '/packs';
    const reader = readerFor({
      [path.join(parent, 'README.md', 'pack.json')]: VALID_MANIFEST,
    });
    const lister = listerFor({
      [parent]: [{ name: 'README.md', isDirectory: false }],
    });

    const result = await discoverPacks([parent], reader, lister);

    expect(result.packs).toEqual([]);
    expect(result.skipped).toEqual([
      { folder: parent, reason: 'no readable pack.json' },
    ]);
  });

  it('reports an invalid child manifest by its own (child) folder path, not the parent', async () => {
    const parent = '/packs';
    const child = '/packs/broken';
    const reader = readerFor({
      [path.join(child, 'pack.json')]: JSON.stringify({ name: 'broken' }), // missing "engine"/"components"
    });
    const lister = listerFor({
      [parent]: [{ name: 'broken', isDirectory: true }],
    });

    const result = await discoverPacks([parent], reader, lister);

    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.folder).toBe(child);
  });

  it('quietly skips a parent folder with neither its own manifest nor any child manifest', async () => {
    const parent = '/packs/empty';
    const reader = readerFor({});
    const lister = listerFor({
      [parent]: [{ name: 'notes', isDirectory: true }],
    });

    const result = await discoverPacks([parent], reader, lister);

    expect(result.packs).toEqual([]);
    expect(result.skipped).toEqual([
      { folder: parent, reason: 'no readable pack.json' },
    ]);
  });

  it('two children sharing a namespace collide, same as two top-level configured folders would', async () => {
    const parent = '/packs';
    const readerFiles: Record<string, string> = {
      [path.join(parent, 'a', 'pack.json')]: VALID_MANIFEST,
      [path.join(parent, 'b', 'pack.json')]: VALID_MANIFEST,
    };
    const lister = listerFor({
      [parent]: [
        { name: 'a', isDirectory: true },
        { name: 'b', isDirectory: true },
      ],
    });

    const result = await discoverPacks(
      [parent],
      readerFor(readerFiles),
      lister,
    );

    expect(result.packs).toEqual([]);
    expect(result.collisions).toEqual(['demo']);
  });
});
