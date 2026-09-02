import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import type { DiscoveredPack } from '@markii/host';
import {
  createNodeArchiveExtractFs,
  isPackArchivePath,
  mergeArchiveAndFolderPacks,
  partitionConfiguredPackPaths,
  resolveArchivePacksForPreview,
  resolveArchivePacksManifestOnly,
  writeArchiveContents,
} from './archive-packs.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-archive-packs-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Builds a well-formed `.mkp` archive's bytes for a pack of `name`. */
function buildArchiveBytes(options: {
  name: string;
  version?: string;
  withStylesheet?: boolean;
  withScript?: boolean;
  withEscapingEntry?: boolean;
}): Uint8Array {
  const manifest: Record<string, unknown> = {
    name: options.name,
    engine: 'react',
    components: { widget: './Widget.tsx' },
  };
  if (options.version !== undefined) manifest.version = options.version;
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    'pack.json': encoder.encode(JSON.stringify(manifest)),
    'webview.js': encoder.encode('window.__markiiRegisterPack(() => ({}));'),
  };
  if (options.withStylesheet) {
    files['webview.css'] = encoder.encode(`.${options.name}_widget {}`);
  }
  if (options.withScript) {
    files['scripts/http.lua'] = encoder.encode('return {}');
  }
  if (options.withEscapingEntry) {
    files['../escape.txt'] = encoder.encode('nope');
  }
  return zipSync(files);
}

describe('isPackArchivePath / partitionConfiguredPackPaths', () => {
  it('recognizes .mkp case-insensitively and leaves plain folders alone', () => {
    expect(isPackArchivePath('/packs/ana.mkp')).toBe(true);
    expect(isPackArchivePath('/packs/ANA.MKP')).toBe(true);
    expect(isPackArchivePath('/packs/ana')).toBe(false);
  });

  it('splits a mixed list into folder paths and archive paths, preserving order within each', () => {
    const result = partitionConfiguredPackPaths([
      '/packs/ana',
      '/packs/cat.mkp',
      '/packs/dog',
    ]);
    expect(result.folderPaths).toEqual(['/packs/ana', '/packs/dog']);
    expect(result.archivePaths).toEqual(['/packs/cat.mkp']);
  });
});

describe('resolveArchivePacksForPreview', () => {
  it('extracts a valid archive into the cache dir as a loadable prebuilt pack', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'ana.mkp');
    await writeFile(
      archivePath,
      buildArchiveBytes({
        name: 'ana',
        withStylesheet: true,
        withScript: true,
      }),
    );
    const cacheDir = path.join(workDir, 'cache');

    const result = await resolveArchivePacksForPreview([archivePath], cacheDir);

    expect(result.skipped).toEqual([]);
    expect(result.packs).toHaveLength(1);
    const pack = result.packs[0]!;
    expect(pack.manifest.name).toBe('ana');
    expect(pack.folder.startsWith(cacheDir)).toBe(true);

    const scriptText = await readFile(pack.scriptPath, 'utf8');
    expect(scriptText).toContain('__markiiRegisterPack');
    const styleText = await readFile(
      path.join(pack.folder, 'webview.css'),
      'utf8',
    );
    expect(styleText).toContain('ana_widget');
    const luaText = await readFile(
      path.join(pack.scriptsDir, 'http.lua'),
      'utf8',
    );
    expect(luaText).toBe('return {}');
  });

  it('re-extracting wipes stale files an earlier version of the archive left behind', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'ana.mkp');
    const cacheDir = path.join(workDir, 'cache');

    await writeFile(
      archivePath,
      buildArchiveBytes({ name: 'ana', withScript: true }),
    );
    const first = await resolveArchivePacksForPreview([archivePath], cacheDir);
    const scriptsDir = first.packs[0]!.scriptsDir;
    expect(await readdir(scriptsDir)).toContain('http.lua');

    // A new version of the same archive, at the same path, with no scripts/.
    await writeFile(archivePath, buildArchiveBytes({ name: 'ana' }));
    const second = await resolveArchivePacksForPreview([archivePath], cacheDir);
    expect(second.packs).toHaveLength(1);
    // Same cache folder (stable per source path) but the stale lua file is
    // gone rather than left sitting alongside the new content.
    expect(second.packs[0]!.folder).toBe(first.packs[0]!.folder);
    const entries = await readdir(scriptsDir).catch(() => []);
    expect(entries).not.toContain('http.lua');
  });

  it('rejects a path-escaping entry and writes nothing outside the cache dir', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'hostile.mkp');
    await writeFile(
      archivePath,
      buildArchiveBytes({ name: 'hostile', withEscapingEntry: true }),
    );
    const cacheDir = path.join(workDir, 'cache');

    const result = await resolveArchivePacksForPreview([archivePath], cacheDir);

    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason.length).toBeGreaterThan(0);
    // Nothing was written anywhere near the workspace/cache root's parent.
    await expect(readdir(workDir)).resolves.toEqual(
      expect.arrayContaining(['hostile.mkp']),
    );
  });

  it('rejects a manifest-invalid archive with a reason, and touches no disk', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'bad.mkp');
    const encoder = new TextEncoder();
    await writeFile(
      archivePath,
      zipSync({
        'pack.json': encoder.encode(JSON.stringify({ name: 'Bad Name!' })),
        'webview.js': encoder.encode('x'),
      }),
    );
    const cacheDir = path.join(workDir, 'cache');

    const result = await resolveArchivePacksForPreview([archivePath], cacheDir);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it('skips every archive with a plain reason when no cache dir is available', async () => {
    const result = await resolveArchivePacksForPreview(
      ['/somewhere/ana.mkp'],
      undefined,
    );
    expect(result.packs).toEqual([]);
    expect(result.skipped).toEqual([
      {
        folder: '/somewhere/ana.mkp',
        reason: expect.stringContaining('no pack-cache directory'),
      },
    ]);
  });
});

describe('resolveArchivePacksManifestOnly', () => {
  it('reads a pack manifest with no filesystem write at all', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'ana.mkp');
    await writeFile(archivePath, buildArchiveBytes({ name: 'ana' }));

    const packs = await resolveArchivePacksManifestOnly([archivePath]);
    expect(packs).toHaveLength(1);
    expect(packs[0]!.manifest.name).toBe('ana');
    // Nothing was created next to the archive.
    expect(await readdir(workDir)).toEqual(['ana.mkp']);
  });

  it('quietly omits an unreadable or invalid archive', async () => {
    const packs = await resolveArchivePacksManifestOnly([
      '/definitely/not/a/real.mkp',
    ]);
    expect(packs).toEqual([]);
  });
});

describe('mergeArchiveAndFolderPacks', () => {
  function pack(name: string, folder = `/packs/${name}`): DiscoveredPack {
    return {
      folder,
      manifest: { name, engine: 'react', components: {} },
      componentPaths: {},
      scriptsDir: `${folder}/scripts`,
      scriptPath: `${folder}/webview.js`,
    };
  }

  it('keeps every pack when no namespace collides', () => {
    const result = mergeArchiveAndFolderPacks([pack('ana')], [pack('cat')]);
    expect(result.packs.map((p) => p.manifest.name)).toEqual(['ana', 'cat']);
    expect(result.skipped).toEqual([]);
  });

  it('drops BOTH sides of a namespace collision between a folder pack and an archive pack', () => {
    const folderPack = pack('ana', '/packs/ana');
    const archivePack = pack('ana', '/cache/ana-archive');
    const result = mergeArchiveAndFolderPacks([folderPack], [archivePack]);
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.folder).sort()).toEqual(
      ['/cache/ana-archive', '/packs/ana'].sort(),
    );
  });
});

describe('writeArchiveContents + createNodeArchiveExtractFs', () => {
  it('writes pack.json, webview.js, webview.css and nested scripts/ modules', async () => {
    const workDir = await makeTempDir();
    const target = path.join(workDir, 'out');
    const fs = createNodeArchiveExtractFs();

    await writeArchiveContents(
      {
        manifest: { name: 'ana', engine: 'react', components: {} },
        manifestWarnings: [],
        scriptBytes: new TextEncoder().encode('script'),
        stylesheetBytes: new TextEncoder().encode('style'),
        scriptModules: {
          'http.lua': new TextEncoder().encode('return {}'),
          'nested/sub.lua': new TextEncoder().encode('return 1'),
        },
        ignoredEntries: [],
      },
      target,
      fs,
    );

    expect(await readFile(path.join(target, 'pack.json'), 'utf8')).toContain(
      '"ana"',
    );
    expect(await readFile(path.join(target, 'webview.js'), 'utf8')).toBe(
      'script',
    );
    expect(await readFile(path.join(target, 'webview.css'), 'utf8')).toBe(
      'style',
    );
    expect(
      await readFile(path.join(target, 'scripts', 'http.lua'), 'utf8'),
    ).toBe('return {}');
    expect(
      await readFile(path.join(target, 'scripts', 'nested', 'sub.lua'), 'utf8'),
    ).toBe('return 1');
  });
});
