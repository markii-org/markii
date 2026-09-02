import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createRegistry } from '@markii/react';
import { loadPackContext } from './pack-context.js';
import type { BundledPackAsset } from './bundled-packs.js';

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
  it('loads a real, installed prebuilt pack and its Lua module into the registry', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'demo');
    await writePackManifest(packDir, 'demo');
    await mkdir(path.join(packDir, 'scripts'), { recursive: true });
    await writeFile(
      path.join(packDir, 'webview.js'),
      registeringScript('demo'),
    );
    await writeFile(path.join(packDir, 'scripts', 'util.lua'), 'return 1');

    const context = await loadPackContext([packDir], createRegistry());

    expect(context.namespaces).toEqual(['demo']);
    expect(context.packs).toHaveLength(1);
    expect(context.packModules.demo).toEqual({ 'util.lua': 'return 1' });
    expect(context.skipped).toEqual([]);
    expect(context.registry['demo_widget']).toBeDefined();
    expect(context.invalidRegistrationReasons).toEqual([]);
    expect(context.registrationCollisions).toEqual([]);
  });

  it('skips a discovered pack with no prebuilt webview.js — it is never compiled', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'nopreview');
    await writePackManifest(packDir, 'nopreview');

    const base = createRegistry();
    const context = await loadPackContext([packDir], base);

    expect(context.packs).toHaveLength(1); // still discovered
    expect(context.registry).toBe(base);
    expect(context.skipped).toHaveLength(1);
    expect(context.skipped[0]!.reason).toContain('no prebuilt webview.js');
    expect(context.skipped[0]!.reason).not.toMatch(/esbuild/i);
  });

  it('quietly skips a folder with no pack.json', async () => {
    const root = await makeTempDir();
    const missing = path.join(root, 'missing');
    const context = await loadPackContext([missing], createRegistry());
    expect(context.packs).toEqual([]);
    expect(context.skipped).toHaveLength(1);
  });

  it('a pack whose script throws while running is skipped, with a reason, and never crashes the whole load', async () => {
    const root = await makeTempDir();
    const packDir = path.join(root, 'broken');
    await writePackManifest(packDir, 'broken');
    await writeFile(
      path.join(packDir, 'webview.js'),
      'throw new Error("boom");',
    );

    const context = await loadPackContext([packDir], createRegistry());

    expect(context.packs).toHaveLength(1); // still discovered
    expect(context.skipped).toHaveLength(1);
    expect(context.skipped[0]!.reason).toContain('boom');
    expect(Object.keys(context.registry)).not.toContain('broken_widget');
  });
});

describe('loadPackContext — prebuilt pack shape', () => {
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

    const context = await loadPackContext([packDir], createRegistry());

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

    const context = await loadPackContext([packDir], createRegistry());

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

    const context = await loadPackContext([packDir], createRegistry());

    expect(context.registry['shadowed_widget']).toBeDefined();
    expect(context.prebuiltShadowedPacks).toEqual([
      { name: 'shadowed', folder: packDir },
    ]);
    expect(context.skipped).toEqual([]);
  });
});

describe('loadPackContext — folder name and namespace must agree', () => {
  it('does not load a folder whose pack.json declares a different namespace', async () => {
    const root = await makeTempDir();
    // A hand copy: the folder is named `demo`, which is what a trust
    // entry would authorize, but the manifest inside claims `other`.
    const packDir = path.join(root, 'demo');
    await writePackManifest(packDir, 'other');
    await writeFile(
      path.join(packDir, 'webview.js'),
      registeringScript('other'),
    );

    const context = await loadPackContext([packDir], createRegistry());

    expect(context.packs).toHaveLength(0);
    expect(context.namespaces).toEqual([]);
    expect(context.skipped.map((entry) => entry.reason).join(' ')).toContain(
      'declares namespace "other"',
    );
  });
});

describe('loadPackContext — namespace collision', () => {
  it('two packs sharing a namespace: both discovered but neither registers, and the base registry is untouched', async () => {
    const root = await makeTempDir();
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    await writePackManifest(a, 'demo');
    await writePackManifest(b, 'demo');

    const context = await loadPackContext([a, b], createRegistry());

    expect(context.packs).toEqual([]); // discover.ts itself already rejects the collision
    expect(context.skipped).toHaveLength(2);
  });
});

function bundledManifest(name: string): string {
  return JSON.stringify({
    name,
    engine: 'react',
    components: { widget: './Widget.tsx' },
  });
}

function bundledAsset(
  name: string,
  overrides: Partial<BundledPackAsset> = {},
): BundledPackAsset {
  return {
    name,
    manifestJson: bundledManifest(name),
    scriptText: registeringScript(name),
    luaModules: {},
    ...overrides,
  };
}

describe('loadPackContext — bundled packs', () => {
  it('folds a bundled pack in even with no installed packs, ahead of the base registry', async () => {
    const context = await loadPackContext([], createRegistry(), {
      bundledPacks: [bundledAsset('read')],
    });

    expect(context.namespaces).toEqual(['read']);
    expect(context.packs).toHaveLength(1);
    expect(context.packs[0]!.folder).toBe('bundled:read');
    expect(context.registry['read_widget']).toBeDefined();
    expect(context.skipped).toEqual([]);
  });

  it('registers bundled packs before installed packs — bundled first in packs/namespaces order', async () => {
    const root = await makeTempDir();
    const demoDir = path.join(root, 'demo');
    await writePackManifest(demoDir, 'demo');
    await writeFile(
      path.join(demoDir, 'webview.js'),
      registeringScript('demo'),
    );

    const context = await loadPackContext([demoDir], createRegistry(), {
      bundledPacks: [bundledAsset('read'), bundledAsset('dash')],
    });

    expect(context.namespaces).toEqual(['read', 'dash', 'demo']);
    expect(context.packs.map((pack) => pack.manifest.name)).toEqual([
      'read',
      'dash',
      'demo',
    ]);
    expect(context.registry['read_widget']).toBeDefined();
    expect(context.registry['dash_widget']).toBeDefined();
    expect(context.registry['demo_widget']).toBeDefined();
  });

  it('an installed pack claiming a namespace a bundled pack already holds is skipped, with a reason, and the bundled pack still loads', async () => {
    const root = await makeTempDir();
    // Named `read`, like every installed pack folder: a folder whose name
    // and manifest namespace disagree is rejected earlier, by its own rule.
    const userReadDir = path.join(root, 'read');
    await writePackManifest(userReadDir, 'read');
    await writeFile(
      path.join(userReadDir, 'webview.js'),
      `window.__markiiRegisterPack(
        JSON.stringify({ name: 'read', engine: 'react', components: { impostor: './Impostor.tsx' } }),
        { impostor: { component: function () { return null; }, inline: false } },
      );`,
    );

    const context = await loadPackContext([userReadDir], createRegistry(), {
      bundledPacks: [bundledAsset('read')],
    });

    // Bundled pack wins the namespace outright.
    expect(context.packs).toHaveLength(1);
    expect(context.packs[0]!.folder).toBe('bundled:read');
    expect(context.registry['read_widget']).toBeDefined();
    expect(context.registry['read_impostor']).toBeUndefined();

    // The installed pack is skipped with a locatable reason naming the real folder.
    expect(context.skipped).toHaveLength(1);
    expect(context.skipped[0]!.folder).toBe(userReadDir);
    expect(context.skipped[0]!.reason).toContain(
      'already used by a bundled pack',
    );
  });

  it("merges a bundled pack's Lua modules into packModules alongside installed packs'", async () => {
    const root = await makeTempDir();
    const demoDir = path.join(root, 'demo');
    await writePackManifest(demoDir, 'demo');
    await mkdir(path.join(demoDir, 'scripts'), { recursive: true });
    await writeFile(path.join(demoDir, 'scripts', 'a.lua'), 'return "user"');

    const context = await loadPackContext([demoDir], createRegistry(), {
      bundledPacks: [
        bundledAsset('read', { luaModules: { 'b.lua': 'return "bundled"' } }),
      ],
    });

    expect(context.packModules.read).toEqual({ 'b.lua': 'return "bundled"' });
    expect(context.packModules.demo).toEqual({ 'a.lua': 'return "user"' });
  });

  it('a bundled pack whose script throws is skipped, with a reason, and never crashes the load', async () => {
    const context = await loadPackContext([], createRegistry(), {
      bundledPacks: [
        bundledAsset('read', { scriptText: 'throw new Error("boom");' }),
      ],
    });

    expect(context.packs).toHaveLength(1); // still discovered
    expect(context.skipped).toHaveLength(1);
    expect(context.skipped[0]!.reason).toContain('boom');
    expect(Object.keys(context.registry)).not.toContain('read_widget');
  });

  it('a malformed bundled manifest is recorded as invalid rather than crashing the load', async () => {
    const context = await loadPackContext([], createRegistry(), {
      bundledPacks: [bundledAsset('bad', { manifestJson: 'not json' })],
    });

    expect(context.packs).toEqual([]);
    expect(context.skipped).toHaveLength(1);
    expect(context.skipped[0]!.reason).toContain('invalid');
  });

  it('with no bundledPacks option at all, behaves exactly as before (backward compatible default)', async () => {
    const root = await makeTempDir();
    const demoDir = path.join(root, 'demo');
    await writePackManifest(demoDir, 'demo');
    await writeFile(
      path.join(demoDir, 'webview.js'),
      registeringScript('demo'),
    );

    const context = await loadPackContext([demoDir], createRegistry());

    expect(context.packs).toHaveLength(1);
    expect(context.packs[0]!.manifest.name).toBe('demo');
  });
});
