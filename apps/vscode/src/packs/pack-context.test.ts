import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { loadPackContext } from './pack-context.js';
import type { PackWebviewBuilder } from './pack-context.js';

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

describe('loadPackContext — compiling a pack with no prebuilt webview.js', () => {
  it('never invokes buildWebviewScript when no cacheDir is configured (unchanged default behavior)', async () => {
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

    let called = false;
    const buildWebviewScript: PackWebviewBuilder = async () => {
      called = true;
      return { kind: 'skipped' };
    };

    const context = await loadPackContext(['nopreview'], root, {
      buildWebviewScript,
    });

    expect(called).toBe(false);
    expect(context.webviewPacks).toEqual([]);
    expect(context.skipped).toEqual([]);
  });

  it('uses the compiled script path and adds the pack to webviewPacks on a successful build', async () => {
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
    const cacheDir = await makeTempDir();
    const compiledPath = path.join(cacheDir, 'nopreview-abc123.js');

    const buildWebviewScript: PackWebviewBuilder = async () => ({
      kind: 'built',
      scriptPath: compiledPath,
      warnings: [],
    });

    const context = await loadPackContext(['nopreview'], root, {
      cacheDir,
      buildWebviewScript,
    });

    expect(context.webviewPacks).toHaveLength(1);
    expect(context.webviewPacks[0]!.webviewScriptPath).toBe(compiledPath);
    expect(context.packs[0]!.webviewScriptPath).not.toBe(compiledPath); // the original DiscoveredPack is untouched
    expect(context.skipped).toEqual([]);
    expect(context.cssWarnings).toEqual([]);
  });

  it('carries a built stylesheet path and CSS lint warnings through to webviewPacks/cssWarnings', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'styled');
    await mkdir(packDir, { recursive: true });
    await writeFile(
      path.join(packDir, 'pack.json'),
      JSON.stringify({
        name: 'styled',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    );
    const cacheDir = await makeTempDir();
    const compiledPath = path.join(cacheDir, 'styled-abc123.js');
    const stylesheetPath = path.join(cacheDir, 'styled-abc123.css');

    const buildWebviewScript: PackWebviewBuilder = async () => ({
      kind: 'built',
      scriptPath: compiledPath,
      stylesheetPath,
      warnings: [
        'pack "styled" CSS uses a raw color literal in "color: #fff;"',
      ],
    });

    const context = await loadPackContext(['styled'], root, {
      cacheDir,
      buildWebviewScript,
    });

    expect(context.webviewPacks[0]!.webviewStylesheetPath).toBe(stylesheetPath);
    expect(context.cssWarnings).toEqual([
      'pack "styled" CSS uses a raw color literal in "color: #fff;"',
    ]);
  });

  it('records a build failure in skipped, excludes the pack from webviewPacks, and never throws', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'broken');
    await mkdir(packDir, { recursive: true });
    await writeFile(
      path.join(packDir, 'pack.json'),
      JSON.stringify({
        name: 'broken',
        engine: 'react',
        components: { widget: './Widget.tsx' },
      }),
    );
    const cacheDir = await makeTempDir();

    const buildWebviewScript: PackWebviewBuilder = async () => ({
      kind: 'failed',
      reason: 'Unexpected token in Widget.tsx',
    });

    const context = await loadPackContext(['broken'], root, {
      cacheDir,
      buildWebviewScript,
    });

    expect(context.packs).toHaveLength(1); // still discovered — namespace and Lua modules are real
    expect(context.webviewPacks).toEqual([]);
    expect(context.skipped).toHaveLength(1);
    expect(context.skipped[0]!.reason).toContain(
      'Unexpected token in Widget.tsx',
    );
  });

  it('prefers a prebuilt webview.js over compiling, and never calls buildWebviewScript for it', async () => {
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
    await writeFile(path.join(packDir, 'webview.js'), '// prebuilt');
    const cacheDir = await makeTempDir();

    let called = false;
    const buildWebviewScript: PackWebviewBuilder = async () => {
      called = true;
      return { kind: 'skipped' };
    };

    const context = await loadPackContext(['demo'], root, {
      cacheDir,
      buildWebviewScript,
    });

    expect(called).toBe(false);
    expect(context.webviewPacks).toHaveLength(1);
    expect(context.webviewPacks[0]!.webviewScriptPath).toBe(
      path.join(packDir, 'webview.js'),
    );
  });
});
