import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { normalizePackTrustList } from './pack-trust.js';
import {
  createNodePackDirLister,
  selectLoadablePackFolders,
} from './installed-packs.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-obsidian-installed-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('createNodePackDirLister', () => {
  it('lists immediate subdirectory names, ignoring files', async () => {
    const root = await makeTempDir();
    await mkdir(path.join(root, 'read'));
    await mkdir(path.join(root, 'dash'));
    await writeFile(path.join(root, 'stray.txt'), 'x');

    const names = createNodePackDirLister()(root).slice().sort();
    expect(names).toEqual(['dash', 'read']);
  });

  it('never throws for a missing install root', () => {
    expect(createNodePackDirLister()('/definitely/not/a/real/path')).toEqual(
      [],
    );
  });
});

describe('selectLoadablePackFolders', () => {
  it('a namespace present on disk and trusted is loadable', () => {
    const trust = normalizePackTrustList({
      entries: [{ namespace: 'read', version: '1.0.0' }],
    });
    const result = selectLoadablePackFolders('/root', ['read'], trust);
    expect(result.loadable).toEqual([
      {
        namespace: 'read',
        folder: path.join('/root', 'read'),
        trustEntry: { namespace: 'read', version: '1.0.0' },
      },
    ]);
    expect(result.notEnabled).toEqual([]);
  });

  it('a namespace present on disk but not trusted is reported as not enabled, and never loadable', () => {
    const trust = normalizePackTrustList({ entries: [] });
    const result = selectLoadablePackFolders('/root', ['mystery'], trust);
    expect(result.loadable).toEqual([]);
    expect(result.notEnabled).toEqual(['mystery']);
  });

  it('a trusted namespace no longer on disk contributes to neither list', () => {
    const trust = normalizePackTrustList({
      entries: [{ namespace: 'deleted' }],
    });
    const result = selectLoadablePackFolders('/root', [], trust);
    expect(result.loadable).toEqual([]);
    expect(result.notEnabled).toEqual([]);
  });

  it('handles a mix of loadable and not-enabled namespaces', () => {
    const trust = normalizePackTrustList({
      entries: [{ namespace: 'read' }],
    });
    const result = selectLoadablePackFolders(
      '/root',
      ['read', 'mystery'],
      trust,
    );
    expect(result.loadable.map((entry) => entry.namespace)).toEqual(['read']);
    expect(result.notEnabled).toEqual(['mystery']);
  });
});
