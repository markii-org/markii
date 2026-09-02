import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  bundledPacksFolder,
  discoverBundledPacks,
  mergeBundledPacks,
} from './bundled-packs.js';
import type { DiscoveredPack } from '@markii/host';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-bundled-packs-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function fakePack(name: string, folder: string): DiscoveredPack {
  return {
    folder,
    manifest: { name, engine: 'react', components: {} },
    componentPaths: {},
    scriptsDir: path.join(folder, 'scripts'),
    scriptPath: path.join(folder, 'webview.js'),
  };
}

describe('bundledPacksFolder', () => {
  it('is dist/packs under the given extension install directory', () => {
    expect(bundledPacksFolder('/ext')).toBe(path.join('/ext', 'dist', 'packs'));
  });
});

describe('discoverBundledPacks', () => {
  it('discovers every pack under dist/packs (the one-level parent-folder scan)', async () => {
    const extensionPath = await makeTempDir();
    const packsDir = bundledPacksFolder(extensionPath);
    for (const name of ['read', 'dash']) {
      await mkdir(path.join(packsDir, name), { recursive: true });
      await writeFile(
        path.join(packsDir, name, 'pack.json'),
        JSON.stringify({ name, engine: 'react', components: {} }),
      );
    }

    const packs = await discoverBundledPacks(extensionPath);

    expect(packs.map((pack) => pack.manifest.name).sort()).toEqual([
      'dash',
      'read',
    ]);
  });

  it('resolves to no packs when dist/packs does not exist yet', async () => {
    const extensionPath = await makeTempDir();
    const packs = await discoverBundledPacks(extensionPath);
    expect(packs).toEqual([]);
  });
});

describe('mergeBundledPacks', () => {
  it('orders bundled packs ahead of every user pack', () => {
    const bundled = [fakePack('read', '/bundled/read')];
    const user = [fakePack('demo', '/user/demo')];

    const merged = mergeBundledPacks(bundled, user);

    expect(merged.packs.map((pack) => pack.manifest.name)).toEqual([
      'read',
      'demo',
    ]);
    expect(merged.skipped).toEqual([]);
  });

  it('drops a user pack sharing a bundled namespace and reports it in skipped, bundled wins', () => {
    const bundled = [fakePack('read', '/bundled/read')];
    const user = [fakePack('read', '/user/read')];

    const merged = mergeBundledPacks(bundled, user);

    expect(merged.packs).toHaveLength(1);
    expect(merged.packs[0]?.folder).toBe('/bundled/read');
    expect(merged.skipped).toHaveLength(1);
    expect(merged.skipped[0]?.folder).toBe('/user/read');
    expect(merged.skipped[0]?.reason).toContain('bundled pack');
  });

  it('keeps every user pack when no namespace collides', () => {
    const bundled = [
      fakePack('read', '/bundled/read'),
      fakePack('dash', '/bundled/dash'),
    ];
    const user = [
      fakePack('demo', '/user/demo'),
      fakePack('other', '/user/other'),
    ];

    const merged = mergeBundledPacks(bundled, user);

    expect(merged.packs.map((pack) => pack.manifest.name)).toEqual([
      'read',
      'dash',
      'demo',
      'other',
    ]);
    expect(merged.skipped).toEqual([]);
  });

  it('passes through unchanged with no bundled packs at all', () => {
    const user = [fakePack('demo', '/user/demo')];
    const merged = mergeBundledPacks([], user);
    expect(merged.packs).toEqual(user);
    expect(merged.skipped).toEqual([]);
  });
});
