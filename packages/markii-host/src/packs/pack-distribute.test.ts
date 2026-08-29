import { describe, expect, it, vi } from 'vitest';
import {
  buildPackForDistribution,
  resolveDistributionTarget,
} from './pack-distribute.js';
import type {
  ConfirmPackOverwrite,
  PackDistributionBuilder,
  PackDistributionFs,
} from './pack-distribute.js';
import type { DiscoveredPack } from './discover.js';

function packAt(folder: string): DiscoveredPack {
  return {
    folder,
    manifest: {
      name: 'ana',
      engine: 'react',
      components: { timeline: './Timeline.tsx' },
    },
    componentPaths: { timeline: `${folder}/Timeline.tsx` },
    scriptsDir: `${folder}/scripts`,
    scriptPath: `${folder}/webview.js`,
  };
}

function fakeFs(
  overrides: Partial<PackDistributionFs> = {},
): PackDistributionFs & {
  written: Map<string, string>;
  deleted: string[];
} {
  const written = new Map<string, string>();
  const deleted: string[] = [];
  return {
    written,
    deleted,
    exists: overrides.exists ?? (async () => false),
    readFile: overrides.readFile ?? (async () => undefined),
    writeFile:
      overrides.writeFile ??
      (async (p, text) => {
        written.set(p, text);
      }),
    deleteFile:
      overrides.deleteFile ??
      (async (p) => {
        deleted.push(p);
      }),
  };
}

const alwaysConfirm: ConfirmPackOverwrite = async () => true;
const neverConfirm: ConfirmPackOverwrite = async () => false;

describe('resolveDistributionTarget', () => {
  it('resolves a plain filename inside the pack folder', () => {
    expect(resolveDistributionTarget('/packs/ana', 'webview.js')).toBe(
      '/packs/ana/webview.js',
    );
  });

  for (const bad of [
    '../evil.js',
    '/etc/passwd',
    'sub/dir.js',
    '',
    '.',
    '..',
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(resolveDistributionTarget('/packs/ana', bad)).toBeUndefined();
    });
  }
});

describe('buildPackForDistribution', () => {
  it('never calls fs.writeFile with a path outside pack.folder', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      readFile: async (p) => (p === '/cache/ana.js' ? '(script)' : undefined),
    });
    const build: PackDistributionBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      warnings: [],
    });

    await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    for (const writtenPath of fs.written.keys()) {
      expect(writtenPath.startsWith('/packs/ana/')).toBe(true);
    }
  });

  it('happy path: writes the script only when the build has no stylesheet', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      readFile: async (p) => (p === '/cache/ana.js' ? '(script)' : undefined),
    });
    const build: PackDistributionBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      warnings: ['warn1'],
    });

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome).toEqual({
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: Buffer.byteLength('(script)', 'utf8'),
      warnings: ['warn1'],
    });
    expect(fs.written.get('/packs/ana/webview.js')).toBe('(script)');
  });

  it('happy path: writes script + stylesheet with correct byte sizes', async () => {
    const pack = packAt('/packs/ana');
    const scriptText = '(function(){})();';
    const cssText = '.ana-timeline{color:red}';
    const fs = fakeFs({
      readFile: async (p) => {
        if (p === '/cache/ana.js') return scriptText;
        if (p === '/cache/ana.css') return cssText;
        return undefined;
      },
    });
    const build: PackDistributionBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      stylesheetPath: '/cache/ana.css',
      warnings: [],
    });

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.scriptPath).toBe('/packs/ana/webview.js');
    expect(outcome.scriptBytes).toBe(Buffer.byteLength(scriptText, 'utf8'));
    expect(outcome.stylesheetPath).toBe('/packs/ana/webview.css');
    expect(outcome.stylesheetBytes).toBe(Buffer.byteLength(cssText, 'utf8'));
    expect(fs.written.get('/packs/ana/webview.css')).toBe(cssText);
  });

  it('asks confirmOverwrite once when a target already exists, and proceeds when confirmed', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      exists: async (p) => p === '/packs/ana/webview.js',
      readFile: async (p) => (p === '/cache/ana.js' ? 'script' : undefined),
    });
    const build: PackDistributionBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      warnings: [],
    });
    const confirm = vi.fn(async () => true);

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: confirm,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      packName: 'ana',
      existingPaths: ['/packs/ana/webview.js'],
    });
    expect(outcome.kind).toBe('written');
  });

  it('declined overwrite writes nothing and returns cancelled', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      exists: async (p) => p === '/packs/ana/webview.js',
      readFile: async (p) => (p === '/cache/ana.js' ? 'script' : undefined),
    });
    const build: PackDistributionBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      warnings: [],
    });

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: neverConfirm,
    });

    expect(outcome).toEqual({ kind: 'cancelled', packName: 'ana' });
    expect(fs.written.size).toBe(0);
  });

  it('removes a stale webview.css when the new build has no stylesheet', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      exists: async (p) =>
        p === '/packs/ana/webview.js' || p === '/packs/ana/webview.css',
      readFile: async (p) => (p === '/cache/ana.js' ? 'script' : undefined),
    });
    const build: PackDistributionBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      warnings: [],
    });

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.removedStylesheetPath).toBe('/packs/ana/webview.css');
    expect(fs.deleted).toEqual(['/packs/ana/webview.css']);
  });

  it('passes a build failure reason through verbatim', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs();
    const build: PackDistributionBuilder = async () => ({
      kind: 'failed',
      reason: 'this Obsidian install has no compiler; see docs',
    });

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome).toEqual({
      kind: 'failed',
      packName: 'ana',
      reason: 'this Obsidian install has no compiler; see docs',
    });
  });

  it('treats a skipped build outcome as a failure', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs();
    const build: PackDistributionBuilder = async () => ({ kind: 'skipped' });

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failed');
    expect(outcome.reason).toContain('ana');
  });

  it('an fs.writeFile that rejects comes back as failed rather than throwing', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      readFile: async (p) => (p === '/cache/ana.js' ? 'script' : undefined),
      writeFile: async () => {
        throw new Error('disk full');
      },
    });
    const build: PackDistributionBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      warnings: [],
    });

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome).toEqual({
      kind: 'failed',
      packName: 'ana',
      reason: 'disk full',
    });
  });

  it('fails cleanly when the built script cannot be read back', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({ readFile: async () => undefined });
    const build: PackDistributionBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      warnings: [],
    });

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('failed');
  });

  it('passes build warnings through unchanged', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      readFile: async (p) => (p === '/cache/ana.js' ? 'script' : undefined),
    });
    const build: PackDistributionBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      warnings: ['pack "ana" CSS uses a raw color literal'],
    });

    const outcome = await buildPackForDistribution({
      pack,
      cacheDir: '/cache',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.warnings).toEqual([
      'pack "ana" CSS uses a raw color literal',
    ]);
  });
});
