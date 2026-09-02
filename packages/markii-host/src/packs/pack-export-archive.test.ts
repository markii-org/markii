import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { exportPackArchive } from './pack-export-archive.js';
import type { PackExportBuilder, PackExportFs } from './pack-export.js';
import type { PackBuildOutcome } from './pack-build.js';
import type { DiscoveredPack } from './discover.js';

function packAt(folder: string, version?: string): DiscoveredPack {
  return {
    folder,
    manifest: {
      name: 'ana',
      engine: 'react',
      components: { timeline: './Timeline.tsx' },
      ...(version !== undefined ? { version } : {}),
    },
    componentPaths: { timeline: `${folder}/Timeline.tsx` },
    scriptsDir: `${folder}/scripts`,
    scriptPath: `${folder}/webview.js`,
  };
}

function readOnlyFs(
  files: Record<string, string>,
  directories: Record<string, string[]> = {},
): Pick<PackExportFs, 'readFile' | 'listDirectory'> {
  return {
    readFile: async (p) => files[p],
    listDirectory: async (p) => directories[p] ?? [],
  };
}

const builtOutcome = (
  scriptPath: string,
  stylesheetPath?: string,
): PackBuildOutcome =>
  ({
    kind: 'built',
    scriptPath,
    ...(stylesheetPath !== undefined ? { stylesheetPath } : {}),
    warnings: [],
  }) as PackBuildOutcome;

describe('exportPackArchive', () => {
  it('zips pack.json, the built script, stylesheet, and scripts/*.lua into a single archive', async () => {
    const pack = packAt('/src/ana', '1.2.0');
    const build: PackExportBuilder = async () =>
      builtOutcome('/cache/ana/webview.js', '/cache/ana/webview.css');
    const fs = readOnlyFs(
      {
        '/src/ana/pack.json': JSON.stringify(pack.manifest),
        '/cache/ana/webview.js': 'console.log("script")',
        '/cache/ana/webview.css': '.ana_timeline {}',
        '/src/ana/scripts/http.lua': 'return {}',
      },
      { '/src/ana/scripts': ['http.lua', 'notes.txt'] },
    );

    const outcome = await exportPackArchive({
      pack,
      cacheDir: '/cache',
      build,
      fs,
    });

    expect(outcome.kind).toBe('built');
    if (outcome.kind !== 'built') throw new Error('expected built');
    expect(outcome.fileName).toBe('ana-1.2.0.mkp');
    expect(outcome.scriptFilesCopied).toBe(1); // notes.txt is not .lua
    expect(outcome.warnings).toEqual([]);

    const unzipped = unzipSync(outcome.bytes);
    expect(Object.keys(unzipped).sort()).toEqual(
      ['pack.json', 'scripts/http.lua', 'webview.css', 'webview.js'].sort(),
    );
    expect(strFromU8(unzipped['webview.js']!)).toBe('console.log("script")');
    expect(strFromU8(unzipped['webview.css']!)).toBe('.ana_timeline {}');
    expect(strFromU8(unzipped['scripts/http.lua']!)).toBe('return {}');
    expect(JSON.parse(strFromU8(unzipped['pack.json']!)).name).toBe('ana');
  });

  it('omits webview.css when the build produced none, and names the archive with no version', async () => {
    const pack = packAt('/src/ana');
    const build: PackExportBuilder = async () =>
      builtOutcome('/cache/ana/webview.js');
    const fs = readOnlyFs({
      '/src/ana/pack.json': JSON.stringify(pack.manifest),
      '/cache/ana/webview.js': 'x',
    });

    const outcome = await exportPackArchive({
      pack,
      cacheDir: '/cache',
      build,
      fs,
    });
    expect(outcome.kind).toBe('built');
    if (outcome.kind !== 'built') throw new Error('expected built');
    expect(outcome.fileName).toBe('ana.mkp');
    expect(outcome.stylesheetBytes).toBeUndefined();
    const unzipped = unzipSync(outcome.bytes);
    expect(Object.keys(unzipped)).not.toContain('webview.css');
  });

  it('propagates a build failure verbatim, never writing bytes', async () => {
    const pack = packAt('/src/ana');
    const build: PackExportBuilder = async () =>
      ({ kind: 'failed', reason: 'esbuild exploded' }) as PackBuildOutcome;
    const fs = readOnlyFs({
      '/src/ana/pack.json': JSON.stringify(pack.manifest),
    });

    const outcome = await exportPackArchive({
      pack,
      cacheDir: '/cache',
      build,
      fs,
    });
    expect(outcome).toEqual({
      kind: 'failed',
      packName: 'ana',
      reason: 'esbuild exploded',
    });
  });

  it('fails cleanly when pack.json cannot be read', async () => {
    const pack = packAt('/src/ana');
    const build: PackExportBuilder = async () =>
      builtOutcome('/cache/ana/webview.js');
    const fs = readOnlyFs({});

    const outcome = await exportPackArchive({
      pack,
      cacheDir: '/cache',
      build,
      fs,
    });
    expect(outcome.kind).toBe('failed');
  });
});
