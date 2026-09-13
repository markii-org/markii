import { describe, expect, it } from 'vitest';
import { discoverConfiguredPacks, loadPacksViaAdapter } from './pack-load.js';
import type { HostPackSource } from './adapter.js';

// `discoverConfiguredPacks` reads through `createNodeFileReader()`
// internally (matching both apps' prior identical body), so these tests
// exercise it against real temp directories rather than an injected
// reader — the same posture `discover.test.ts` already takes for the
// underlying `discoverPacks`.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

async function makePackFolder(
  name: string,
  manifest: Record<string, unknown>,
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), `markii-pack-load-${name}-`));
  await writeFile(path.join(dir, 'pack.json'), JSON.stringify(manifest));
  return dir;
}

describe('discoverConfiguredPacks', () => {
  it('discovers a valid pack and reports its namespace', async () => {
    const folder = await makePackFolder('ana', {
      name: 'ana',
      engine: 'react',
      components: { widget: './Widget.tsx' },
    });
    const result = await discoverConfiguredPacks([folder]);
    expect(result.namespaces).toEqual(['ana']);
    expect(result.packs).toHaveLength(1);
    expect(result.skipped).toEqual([]);
  });

  it('engine-gates against react, matching the render path', async () => {
    const folder = await makePackFolder('other-engine', {
      name: 'other-engine',
      engine: 'some-other-engine',
      components: {},
    });
    const result = await discoverConfiguredPacks([folder]);
    expect(result.packs).toEqual([]);
    expect(result.namespaces).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toContain('not supported here');
  });

  it('a missing folder is skipped quietly, never thrown', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'markii-pack-load-empty-'));
    const missing = path.join(dir, 'does-not-exist');
    const result = await discoverConfiguredPacks([missing]);
    expect(result.packs).toEqual([]);
    expect(result.namespaces).toEqual([]);
  });

  // Ported from apps/obsidian's deleted discover-configured-packs.test.ts.
  // An empty list is the ordinary state of a host that loads no packs, so
  // it resolves to nothing without reaching the filesystem at all.
  it('resolves an empty folder list to no packs, without touching the filesystem', async () => {
    const result = await discoverConfiguredPacks([]);
    expect(result.packs).toEqual([]);
    expect(result.namespaces).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe('loadPacksViaAdapter', () => {
  it('discovers over source.authorizedFolders()', async () => {
    const folder = await makePackFolder('cat', {
      name: 'cat',
      engine: 'react',
      components: { card: './Card.tsx' },
    });
    const source: HostPackSource = {
      authorizedFolders: async () => [folder],
      reservedNamespaces: () => new Set(),
    };
    const result = await loadPacksViaAdapter(source);
    expect(result.namespaces).toEqual(['cat']);
  });

  it('an empty authorized-folder list discovers nothing', async () => {
    const source: HostPackSource = {
      authorizedFolders: async () => [],
      reservedNamespaces: () => new Set(),
    };
    const result = await loadPacksViaAdapter(source);
    expect(result.packs).toEqual([]);
    expect(result.namespaces).toEqual([]);
  });
});
