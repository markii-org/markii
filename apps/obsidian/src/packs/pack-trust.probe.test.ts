/**
 * EXECUTED PROBE for the rule the trust list exists to enforce: a pack
 * folder sitting under this plugin's own `packs/` directory runs NOTHING
 * until this device's trust list names its namespace.
 *
 * The rule lives in `@markii/host` (`packages/markii-host/src/host/
 * pack-trust-behavior.ts`) and is shared by every host that declares the
 * device trust list. Unit tests there cover the pieces in isolation, and
 * `conformance/host/16-pack-trust` covers the behavior against every
 * adapter. This file drives the whole chain through this plugin's REAL
 * adapter and the shared `createMarkiiHost` behaviors, then into
 * `loadPackContext`, against real directories and real registration
 * scripts, because
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
import { createMarkiiHost } from '@markii/host';
import type { MarkiiHost } from '@markii/host';
import { loadPackContext } from './pack-context.js';
import { createObsidianHostAdapter } from '../host-adapter.js';

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

/** Records that this pack's script ran, then registers one component, matching `@markii/pack-build`'s `pack-build.ts` output shape. */
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

/** The shared host over this plugin's real adapter, with device-local state in a map that outlives one host instance (as `app.saveLocalStorage` does). */
function makeHost(
  installRoot: string,
  store: Map<string, unknown>,
  answers: boolean[] = [],
): MarkiiHost {
  return createMarkiiHost(
    createObsidianHostAdapter({
      prompt: async () => answers.shift() ?? false,
      loadLocalStorage: (key) => store.get(key),
      saveLocalStorage: (key, value) => {
        store.set(key, value);
      },
      diagnostics: () => {},
      packs: {
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set<string>(),
        installRoot: () => installRoot,
        removeFolder: (folder) => rm(folder, { recursive: true, force: true }),
      },
    }),
  );
}

/** The plugin's own load path, composed exactly as `main.ts`'s `loadPacks` composes it: the shared host decides which folders are enabled, then they are evaluated. */
async function loadInstalled(host: MarkiiHost) {
  const listing = await host.installedPacks();
  if (listing.kind !== 'listed') throw new Error('trust not declared');
  const context = await loadPackContext(
    listing.enabled.map((entry) => entry.folder),
    createRegistry(),
  );
  return { context, notEnabled: listing.notEnabled };
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

    const host = makeHost(installRoot, new Map(), [true]);
    expect(await host.enablePack('trusted')).toEqual({
      kind: 'enabled',
      namespace: 'trusted',
    });
    const { context, notEnabled } = await loadInstalled(host);

    expect(evaluatedPacks()).toEqual(['trusted']);
    expect(context.namespaces).toEqual(['trusted']);
    expect(context.registry['trusted_widget']).toBeDefined();
    expect(context.registry['sneaky_widget']).toBeUndefined();
    expect(notEnabled).toEqual(['sneaky']);
  });

  it('the shared load path never even discovers the untrusted folder', async () => {
    const installRoot = await makeTempDir();
    await writeInstalledPack(installRoot, 'sneaky');
    const host = makeHost(installRoot, new Map());
    const outcome = await host.loadPacks();
    expect(outcome.kind).toBe('loaded');
    if (outcome.kind === 'loaded') expect(outcome.namespaces).toEqual([]);
    expect(evaluatedPacks()).toEqual([]);
  });

  it('enabling that folder is what makes it load, and nothing else changed on disk', async () => {
    const installRoot = await makeTempDir();
    await writeInstalledPack(installRoot, 'sneaky');
    const store = new Map<string, unknown>();

    const before = await loadInstalled(makeHost(installRoot, store));
    expect(evaluatedPacks()).toEqual([]);
    expect(before.notEnabled).toEqual(['sneaky']);

    // A fresh host over the same device-local store: the entry persists.
    const enabling = makeHost(installRoot, store, [true]);
    expect((await enabling.enablePack('sneaky')).kind).toBe('enabled');
    const after = await loadInstalled(makeHost(installRoot, store));

    expect(evaluatedPacks()).toEqual(['sneaky']);
    expect(after.context.registry['sneaky_widget']).toBeDefined();
    expect(after.notEnabled).toEqual([]);
  });

  it('a refused consent prompt leaves the folder unevaluated', async () => {
    const installRoot = await makeTempDir();
    await writeInstalledPack(installRoot, 'sneaky');
    const host = makeHost(installRoot, new Map(), [false]);
    expect((await host.enablePack('sneaky')).kind).toBe('declined');
    const loaded = await loadInstalled(host);
    expect(evaluatedPacks()).toEqual([]);
    expect(loaded.notEnabled).toEqual(['sneaky']);
  });

  it('removing a pack leaves no folder, no trust entry, and nothing loaded', async () => {
    const installRoot = await makeTempDir();
    const packDir = await writeInstalledPack(installRoot, 'doomed');
    const store = new Map<string, unknown>();
    const host = makeHost(installRoot, store, [true]);
    await host.enablePack('doomed');

    const loaded = await loadInstalled(host);
    expect(loaded.context.registry['doomed_widget']).toBeDefined();

    expect((await host.removePack('doomed')).kind).toBe('removed');

    await expect(access(packDir)).rejects.toThrow();
    const reloaded = await loadInstalled(host);
    expect(reloaded.context.namespaces).toEqual([]);
    expect(reloaded.context.registry['doomed_widget']).toBeUndefined();
    expect(reloaded.notEnabled).toEqual([]);
    // The stored list holds no entry for it either.
    expect(store.get('markii:installedPacks')).toEqual({ entries: [] });
  });
});
