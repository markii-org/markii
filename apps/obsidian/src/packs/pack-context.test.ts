import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createRegistry } from '@markii/react';
import { loadPackContext } from './pack-context.js';
import type { PackCompileBuilder } from './pack-context.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(
    path.join(tmpdir(), 'markii-obsidian-pack-context-'),
  );
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function writePackManifest(packDir: string, name: string): Promise<void> {
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

/** A prebuilt registration script that really calls `window.__markiiRegisterPack`, matching `@markii/host`'s `pack-build.ts` output shape, for a test that wants a non-empty `registry`. */
function registeringScript(name: string): string {
  return `
    window.__markiiRegisterPack(
      JSON.stringify({ name: ${JSON.stringify(name)}, engine: 'react', components: { widget: './Widget.tsx' } }),
      { widget: { component: function () { return null; }, inline: false } },
    );
  `;
}

describe('loadPackContext', () => {
  it('discovers a real on-disk pack, its Lua module, and registers its prebuilt script into the registry', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'demo');
    await writePackManifest(packDir, 'demo');
    await mkdir(path.join(packDir, 'scripts'), { recursive: true });
    await writeFile(
      path.join(packDir, 'webview.js'),
      registeringScript('demo'),
    );
    await writeFile(path.join(packDir, 'scripts', 'util.lua'), 'return 1');

    const context = await loadPackContext(['demo'], root, createRegistry());

    expect(context.namespaces).toEqual(['demo']);
    expect(context.packs).toHaveLength(1);
    expect(context.packModules.demo).toEqual({ 'util.lua': 'return 1' });
    expect(context.skipped).toEqual([]);
    expect(context.registry['demo_widget']).toBeDefined();
    expect(context.invalidRegistrationReasons).toEqual([]);
    expect(context.registrationCollisions).toEqual([]);
  });

  it('keeps a pack discovered even with no prebuilt script and no cacheDir — the base registry is unchanged', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'nopreview');
    await writePackManifest(packDir, 'nopreview');

    const base = createRegistry();
    const context = await loadPackContext(['nopreview'], root, base);

    expect(context.packs).toHaveLength(1);
    expect(context.registry).toBe(base);
    expect(context.skipped).toEqual([]);
  });

  it('quietly skips a configured folder with no pack.json', async () => {
    const root = await makeTempDir();
    const context = await loadPackContext(['missing'], root, createRegistry());
    expect(context.packs).toEqual([]);
    expect(context.skipped).toHaveLength(1);
  });

  it('resolves relative entries against the given vault root', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'sub', 'demo');
    await writePackManifest(packDir, 'demo');

    const context = await loadPackContext(['sub/demo'], root, createRegistry());
    expect(context.packs).toHaveLength(1);
    expect(context.relativeEntries).toEqual(['sub/demo']);
  });

  it('a pack whose script throws while running is skipped, with a reason, and never crashes the whole load', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'broken');
    await writePackManifest(packDir, 'broken');
    await writeFile(
      path.join(packDir, 'webview.js'),
      'throw new Error("boom");',
    );

    const context = await loadPackContext(['broken'], root, createRegistry());

    expect(context.packs).toHaveLength(1); // still discovered
    expect(context.skipped).toHaveLength(1);
    expect(context.skipped[0]!.reason).toContain('boom');
    expect(Object.keys(context.registry)).not.toContain('broken_widget');
  });
});

describe('loadPackContext — compiling a pack with no prebuilt script', () => {
  it('never invokes buildRegistrationScript when no cacheDir is configured', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'nopreview');
    await writePackManifest(packDir, 'nopreview');

    let called = false;
    const buildRegistrationScript: PackCompileBuilder = async () => {
      called = true;
      return { kind: 'skipped' };
    };

    const context = await loadPackContext(
      ['nopreview'],
      root,
      createRegistry(),
      {
        buildRegistrationScript,
      },
    );

    expect(called).toBe(false);
    expect(context.skipped).toEqual([]);
  });

  it('uses a successfully built script and merges its registration', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'built');
    await writePackManifest(packDir, 'built');
    const cacheDir = await makeTempDir();
    const compiledPath = path.join(cacheDir, 'built-abc123.js');
    await writeFile(compiledPath, registeringScript('built'));

    const buildRegistrationScript: PackCompileBuilder = async () => ({
      kind: 'built',
      scriptPath: compiledPath,
      warnings: [],
    });

    const context = await loadPackContext(['built'], root, createRegistry(), {
      cacheDir,
      buildRegistrationScript,
    });

    expect(context.registry['built_widget']).toBeDefined();
    expect(context.skipped).toEqual([]);
    expect(context.cssWarnings).toEqual([]);
  });

  it('carries a built stylesheet through to the stylesheets list, keyed by namespace', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'styled');
    await writePackManifest(packDir, 'styled');
    const cacheDir = await makeTempDir();
    const compiledPath = path.join(cacheDir, 'styled-abc123.js');
    const stylesheetPath = path.join(cacheDir, 'styled-abc123.css');
    await writeFile(compiledPath, registeringScript('styled'));
    await writeFile(
      stylesheetPath,
      '.mk-styled-widget { color: var(--mk-fg); }',
    );

    const buildRegistrationScript: PackCompileBuilder = async () => ({
      kind: 'built',
      scriptPath: compiledPath,
      stylesheetPath,
      warnings: [
        'pack "styled" CSS uses a raw color literal in "color: #fff;"',
      ],
    });

    const context = await loadPackContext(['styled'], root, createRegistry(), {
      cacheDir,
      buildRegistrationScript,
    });

    expect(context.stylesheets).toEqual([
      {
        namespace: 'styled',
        cssText: '.mk-styled-widget { color: var(--mk-fg); }',
      },
    ]);
    expect(context.cssWarnings).toEqual([
      'pack "styled" CSS uses a raw color literal in "color: #fff;"',
    ]);
  });

  it('records a build failure in skipped and never throws', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'broken');
    await writePackManifest(packDir, 'broken');
    const cacheDir = await makeTempDir();

    const buildRegistrationScript: PackCompileBuilder = async () => ({
      kind: 'failed',
      reason: 'Unexpected token in Widget.tsx',
    });

    const context = await loadPackContext(['broken'], root, createRegistry(), {
      cacheDir,
      buildRegistrationScript,
    });

    expect(context.packs).toHaveLength(1);
    expect(context.skipped).toHaveLength(1);
    expect(context.skipped[0]!.reason).toContain(
      'Unexpected token in Widget.tsx',
    );
    expect(Object.keys(context.registry)).not.toContain('broken_widget');
  });

  it('prefers a prebuilt script over compiling, and never calls buildRegistrationScript for it', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'demo');
    await writePackManifest(packDir, 'demo');
    await writeFile(
      path.join(packDir, 'webview.js'),
      registeringScript('demo'),
    );
    const cacheDir = await makeTempDir();

    let called = false;
    const buildRegistrationScript: PackCompileBuilder = async () => {
      called = true;
      return { kind: 'skipped' };
    };

    const context = await loadPackContext(['demo'], root, createRegistry(), {
      cacheDir,
      buildRegistrationScript,
    });

    expect(called).toBe(false);
    expect(context.registry['demo_widget']).toBeDefined();
  });
});

describe('loadPackContext — prebuilt pack (issue #15)', () => {
  it('a prebuilt pack with a sibling webview.css contributes a stylesheet keyed by its namespace', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'styled');
    await writePackManifest(packDir, 'styled');
    await writeFile(
      path.join(packDir, 'webview.js'),
      registeringScript('styled'),
    );
    await writeFile(
      path.join(packDir, 'webview.css'),
      '.mk-styled-widget { color: var(--mk-fg); }',
    );

    const context = await loadPackContext(['styled'], root, createRegistry());

    expect(context.registry['styled_widget']).toBeDefined();
    expect(context.stylesheets).toEqual([
      {
        namespace: 'styled',
        cssText: '.mk-styled-widget { color: var(--mk-fg); }',
      },
    ]);
    expect(context.skipped).toEqual([]);
    expect(context.prebuiltShadowedPacks).toEqual([]);
  });

  it('a prebuilt pack with no sibling webview.css contributes no stylesheet', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'plain');
    await writePackManifest(packDir, 'plain');
    await writeFile(
      path.join(packDir, 'webview.js'),
      registeringScript('plain'),
    );

    const context = await loadPackContext(['plain'], root, createRegistry());

    expect(context.registry['plain_widget']).toBeDefined();
    expect(context.stylesheets).toEqual([]);
  });

  it('a prebuilt pack whose folder also holds component sources is reported in prebuiltShadowedPacks, and never counted as skipped', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'shadowed');
    await writePackManifest(packDir, 'shadowed');
    await writeFile(
      path.join(packDir, 'webview.js'),
      registeringScript('shadowed'),
    );
    await writeFile(
      path.join(packDir, 'Widget.tsx'),
      'export default function Widget() { return null; }',
    );

    const context = await loadPackContext(['shadowed'], root, createRegistry());

    expect(context.registry['shadowed_widget']).toBeDefined();
    expect(context.prebuiltShadowedPacks).toEqual([
      { name: 'shadowed', folder: packDir },
    ]);
    expect(context.skipped).toEqual([]);
  });

  it('a prebuilt pack whose sources are not on disk is not reported as shadowed', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'clean');
    await writePackManifest(packDir, 'clean');
    await writeFile(
      path.join(packDir, 'webview.js'),
      registeringScript('clean'),
    );

    const context = await loadPackContext(['clean'], root, createRegistry());

    expect(context.prebuiltShadowedPacks).toEqual([]);
  });

  it('the from-source build path is unchanged: no prebuilt script still goes through buildRegistrationScript', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'built');
    await writePackManifest(packDir, 'built');
    const cacheDir = await makeTempDir();
    const compiledPath = path.join(cacheDir, 'built-abc123.js');
    await writeFile(compiledPath, registeringScript('built'));

    let called = false;
    const buildRegistrationScript: PackCompileBuilder = async () => {
      called = true;
      return { kind: 'built', scriptPath: compiledPath, warnings: [] };
    };

    const context = await loadPackContext(['built'], root, createRegistry(), {
      cacheDir,
      buildRegistrationScript,
    });

    expect(called).toBe(true);
    expect(context.registry['built_widget']).toBeDefined();
    expect(context.prebuiltShadowedPacks).toEqual([]);
  });
});

describe('loadPackContext — namespace collision', () => {
  it('two packs sharing a namespace: both discovered but neither registers, and the base registry is untouched', async () => {
    const root = await makeTempDir();
    await writePackManifest(path.join(root, 'a'), 'demo');
    await writePackManifest(path.join(root, 'b'), 'demo');

    const context = await loadPackContext(['a', 'b'], root, createRegistry());

    expect(context.packs).toEqual([]); // discover.ts itself already rejects the collision
    expect(context.skipped).toHaveLength(2);
  });
});
