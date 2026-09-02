import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { openPackArchive } from '@markii/pack';
import type { DiscoveredPack } from '@markii/host';
import {
  createNodeArchiveExtractFs,
  isPackArchivePath,
  mergeArchiveAndFolderPacks,
  partitionConfiguredPackPaths,
  resolveArchivePacks,
  resolveArchivePacksManifestOnly,
  writeArchiveContents,
} from './archive-packs.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'markii-obsidian-archive-'));
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
  scriptText?: string;
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
    'webview.js': encoder.encode(
      options.scriptText ?? 'window.__markiiRegisterPack(() => ({}));',
    ),
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

describe('resolveArchivePacks', () => {
  it('resolves a valid archive entirely in memory: manifest, script text, stylesheet text, and Lua modules', async () => {
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

    const result = await resolveArchivePacks([archivePath]);

    expect(result.skipped).toEqual([]);
    expect(result.resolved).toHaveLength(1);
    const entry = result.resolved[0]!;
    expect(entry.pack.manifest.name).toBe('ana');
    expect(entry.pack.folder).toBe(archivePath);
    expect(entry.scriptText).toContain('__markiiRegisterPack');
    expect(entry.cssText).toBe('.ana_widget {}');
    expect(entry.luaModules).toEqual({ 'http.lua': 'return {}' });
  });

  it('resolves an archive with no stylesheet or Lua modules to undefined/empty, never throwing', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'bare.mkp');
    await writeFile(archivePath, buildArchiveBytes({ name: 'bare' }));

    const result = await resolveArchivePacks([archivePath]);

    expect(result.skipped).toEqual([]);
    const entry = result.resolved[0]!;
    expect(entry.cssText).toBeUndefined();
    expect(entry.luaModules).toEqual({});
  });

  it('skips a missing file with a plain reason, resolving nothing for it', async () => {
    const result = await resolveArchivePacks(['/does/not/exist.mkp']);
    expect(result.resolved).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('could not be read');
  });

  it('rejects a path-escaping entry and writes nothing outside the archive, since nothing is ever written to disk by this function', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'hostile.mkp');
    await writeFile(
      archivePath,
      buildArchiveBytes({ name: 'hostile', withEscapingEntry: true }),
    );

    const result = await resolveArchivePacks([archivePath]);

    expect(result.resolved).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it('rejects a malformed manifest', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'badmanifest.mkp');
    const encoder = new TextEncoder();
    await writeFile(
      archivePath,
      zipSync({
        'pack.json': encoder.encode('not json'),
        'webview.js': encoder.encode('1'),
      }),
    );

    const result = await resolveArchivePacks([archivePath]);
    expect(result.resolved).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('invalid pack.json');
  });

  it('resolves multiple archives in order, one bad entry among good ones does not affect the others', async () => {
    const workDir = await makeTempDir();
    const goodPath = path.join(workDir, 'good.mkp');
    await writeFile(goodPath, buildArchiveBytes({ name: 'good' }));

    const result = await resolveArchivePacks(['/missing/one.mkp', goodPath]);
    expect(result.skipped).toHaveLength(1);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]!.pack.manifest.name).toBe('good');
  });
});

describe('resolveArchivePacksManifestOnly', () => {
  it('resolves just the manifest, with no filesystem write and no script/Lua decoding', async () => {
    const workDir = await makeTempDir();
    const archivePath = path.join(workDir, 'ana.mkp');
    await writeFile(
      archivePath,
      buildArchiveBytes({ name: 'ana', withScript: true }),
    );

    const packs = await resolveArchivePacksManifestOnly([archivePath]);
    expect(packs).toHaveLength(1);
    expect(packs[0]!.manifest.name).toBe('ana');
  });

  it('silently excludes an invalid or unreadable archive', async () => {
    const packs = await resolveArchivePacksManifestOnly(['/missing.mkp']);
    expect(packs).toEqual([]);
  });
});

describe('mergeArchiveAndFolderPacks', () => {
  function pack(name: string, folder: string): DiscoveredPack {
    return {
      folder,
      manifest: { name, engine: 'react', components: {} },
      componentPaths: {},
      scriptsDir: `${folder}/scripts`,
      scriptPath: `${folder}/webview.js`,
    };
  }

  it('keeps every pack when there is no collision', () => {
    const result = mergeArchiveAndFolderPacks(
      [pack('ana', '/folders/ana')],
      [pack('cat', '/archives/cat.mkp')],
    );
    expect(result.packs.map((p) => p.manifest.name)).toEqual(['ana', 'cat']);
    expect(result.skipped).toEqual([]);
  });

  it('drops BOTH claimants when a folder pack and an archive pack share a namespace', () => {
    const result = mergeArchiveAndFolderPacks(
      [pack('ana', '/folders/ana')],
      [pack('ana', '/archives/ana.mkp')],
    );
    expect(result.packs).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.map((s) => s.folder).sort()).toEqual(
      ['/archives/ana.mkp', '/folders/ana'].sort(),
    );
  });
});

describe('writeArchiveContents / createNodeArchiveExtractFs', () => {
  it('writes pack.json, webview.js, webview.css, and scripts/* into the destination directory', async () => {
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
    const archiveBytes = new Uint8Array(await readFile(archivePath));
    const opened = await openPackArchive(archiveBytes);
    if (!opened.ok) throw new Error('expected a valid archive');

    const destination = path.join(workDir, 'installed', 'ana');
    await writeArchiveContents(
      opened.archive,
      destination,
      createNodeArchiveExtractFs(),
    );

    const manifest = JSON.parse(
      await readFile(path.join(destination, 'pack.json'), 'utf8'),
    ) as { name: string };
    expect(manifest.name).toBe('ana');
    await expect(
      readFile(path.join(destination, 'webview.js'), 'utf8'),
    ).resolves.toContain('__markiiRegisterPack');
    await expect(
      readFile(path.join(destination, 'webview.css'), 'utf8'),
    ).resolves.toBe('.ana_widget {}');
    await expect(
      readFile(path.join(destination, 'scripts', 'http.lua'), 'utf8'),
    ).resolves.toBe('return {}');
  });
});
