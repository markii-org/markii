import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { loadPackContext } from './pack-context.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-pack-context-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('loadPackContext', () => {
  it('discovers a real on-disk pack, its Lua module, and its webview script', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'demo');
    await mkdir(path.join(packDir, 'scripts'), { recursive: true });
    await writeFile(
      path.join(packDir, 'pack.json'),
      JSON.stringify({
        name: 'demo',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    );
    await writeFile(path.join(packDir, 'webview.js'), '// registration script');
    await writeFile(path.join(packDir, 'scripts', 'util.lua'), 'return 1');

    const context = await loadPackContext(['demo'], root);

    expect(context.namespaces).toEqual(['demo']);
    expect(context.packs).toHaveLength(1);
    expect(context.webviewPacks).toHaveLength(1);
    expect(context.packModules.demo).toEqual({ 'util.lua': 'return 1' });
    expect(context.skipped).toEqual([]);
  });

  it('excludes a pack from webviewPacks when it ships no webview.js, but keeps it discovered', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'nopreview');
    await mkdir(packDir, { recursive: true });
    await writeFile(
      path.join(packDir, 'pack.json'),
      JSON.stringify({
        name: 'nopreview',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    );

    const context = await loadPackContext(['nopreview'], root);

    expect(context.packs).toHaveLength(1);
    expect(context.webviewPacks).toEqual([]);
  });

  it('quietly skips a configured folder with no pack.json', async () => {
    const root = await makeTempDir();
    const context = await loadPackContext(['missing'], root);
    expect(context.packs).toEqual([]);
    expect(context.skipped).toHaveLength(1);
  });

  it('resolves relative entries against the given workspace root', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'sub', 'demo');
    await mkdir(packDir, { recursive: true });
    await writeFile(
      path.join(packDir, 'pack.json'),
      JSON.stringify({
        name: 'demo',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    );

    const context = await loadPackContext(['sub/demo'], root);
    expect(context.packs).toHaveLength(1);
  });
});
