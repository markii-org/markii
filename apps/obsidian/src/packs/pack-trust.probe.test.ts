/**
 * EXECUTED PROBE for the rule the trust list exists to enforce: a pack
 * folder sitting under this plugin's own `packs/` directory runs NOTHING
 * until this device's trust list (`./pack-trust.ts`) names its namespace.
 *
 * Unit tests elsewhere cover the pieces in isolation: the pure selection
 * (`./installed-packs.test.ts`), the stored shape (`./pack-trust.test.ts`),
 * the loader (`./pack-context.test.ts`). This file drives the whole chain
 * against real directories and real registration scripts instead, because
 * the claim being made is about code execution, and only running it proves
 * an untrusted pack's script is never evaluated. Each pack's script records
 * itself on a global before registering, so "was this code ever run" is
 * observed directly rather than inferred from the resulting registry.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createRegistry } from '@markii/react';
import { loadPackContext } from './pack-context.js';
import {
  createNodePackDirLister,
  selectLoadablePackFolders,
} from './installed-packs.js';
import {
  normalizePackTrustList,
  trustPack,
  untrustPack,
} from './pack-trust.js';
import type { PackTrustList } from './pack-trust.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-obsidian-trust-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Records that this pack's script ran, then registers one component, matching `@markii/host`'s `pack-build.ts` output shape. */
function recordingScript(name: string): string {
  return `
    (globalThis.__markiiProbeEvaluated ||= []).push(${JSON.stringify(name)});
    window.__markiiRegisterPack(
      JSON.stringify({ name: ${JSON.stringify(name)}, engine: 'react', components: { widget: './Widget.tsx' } }),
      { widget: { component: function () { return null; }, inline: false } },
    );
  `;
}

/** Writes a complete, prebuilt pack folder named by its own namespace, the shape "Install Markii pack from file" produces. */
async function writeInstalledPack(
  installRoot: string,
  name: string,
): Promise<string> {
  const packDir = path.join(installRoot, name);
  await mkdir(packDir, { recursive: true });
  await writeFile(
    path.join(packDir, 'pack.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      engine: 'react',
      components: { widget: './Widget.tsx' },
    }),
  );
  await writeFile(path.join(packDir, 'webview.js'), recordingScript(name));
  return packDir;
}

/** The plugin's own load path, composed exactly as `main.ts`'s `loadPacks` composes it. */
async function loadInstalled(installRoot: string, trust: PackTrustList) {
  const onDisk = createNodePackDirLister()(installRoot);
  const { loadable, notEnabled } = selectLoadablePackFolders(
    installRoot,
    onDisk,
    trust,
  );
  const context = await loadPackContext(
    loadable.map((entry) => entry.folder),
    createRegistry(),
  );
  return { context, notEnabled };
}

function evaluatedPacks(): string[] {
  return ((
    globalThis as { __markiiProbeEvaluated?: string[] }
  ).__markiiProbeEvaluated ??= []);
}

beforeEach(() => {
  (globalThis as { __markiiProbeEvaluated?: string[] }).__markiiProbeEvaluated =
    [];
});

describe('probe: an installed pack folder runs nothing until this device trusts it', () => {
  it('loads the trusted pack and never evaluates the untrusted one sitting beside it', async () => {
    const installRoot = await makeTempDir();
    await writeInstalledPack(installRoot, 'trusted');
    // The hand-copied or Sync-delivered case: a complete, loadable pack
    // folder that this device never authorized.
    await writeInstalledPack(installRoot, 'sneaky');

    const trust = trustPack(normalizePackTrustList({}), 'trusted', '1.0.0');
    const { context, notEnabled } = await loadInstalled(installRoot, trust);

    expect(evaluatedPacks()).toEqual(['trusted']);
    expect(context.namespaces).toEqual(['trusted']);
    expect(context.registry['trusted_widget']).toBeDefined();
    expect(context.registry['sneaky_widget']).toBeUndefined();
    expect(notEnabled).toEqual(['sneaky']);
  });

  it('enabling that folder is what makes it load, and nothing else changed on disk', async () => {
    const installRoot = await makeTempDir();
    await writeInstalledPack(installRoot, 'sneaky');

    const before = await loadInstalled(installRoot, normalizePackTrustList({}));
    expect(evaluatedPacks()).toEqual([]);
    expect(before.notEnabled).toEqual(['sneaky']);

    const trust = trustPack(normalizePackTrustList({}), 'sneaky', '1.0.0');
    const after = await loadInstalled(installRoot, trust);

    expect(evaluatedPacks()).toEqual(['sneaky']);
    expect(after.context.registry['sneaky_widget']).toBeDefined();
    expect(after.notEnabled).toEqual([]);
  });

  it('removing a pack leaves no folder, no trust entry, and nothing loaded', async () => {
    const installRoot = await makeTempDir();
    const packDir = await writeInstalledPack(installRoot, 'doomed');
    let trust = trustPack(normalizePackTrustList({}), 'doomed', '1.0.0');

    const loaded = await loadInstalled(installRoot, trust);
    expect(loaded.context.registry['doomed_widget']).toBeDefined();

    // What `main.ts`'s `removeInstalledPack` does: delete the folder, drop
    // the trust entry, reload.
    await rm(packDir, { recursive: true, force: true });
    trust = untrustPack(trust, 'doomed');

    await expect(access(packDir)).rejects.toThrow();
    expect(trust.entries).toEqual([]);
    const reloaded = await loadInstalled(installRoot, trust);
    expect(reloaded.context.namespaces).toEqual([]);
    expect(reloaded.context.registry['doomed_widget']).toBeUndefined();
    expect(reloaded.notEnabled).toEqual([]);
  });
});
