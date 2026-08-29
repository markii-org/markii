import { describe, expect, it, vi } from 'vitest';
import { exportPack, resolveExportTarget } from './pack-export.js';
import type {
  ConfirmPackOverwrite,
  PackExportBuilder,
  PackExportFs,
} from './pack-export.js';
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
  files: Record<string, string> = {},
  overrides: Partial<PackExportFs> = {},
): PackExportFs & {
  written: Map<string, string>;
  deleted: string[];
  dirsCreated: string[];
} {
  const written = new Map<string, string>();
  const deleted: string[] = [];
  const dirsCreated: string[] = [];
  return {
    written,
    deleted,
    dirsCreated,
    exists: overrides.exists ?? (async (p) => Object.hasOwn(files, p)),
    readFile: overrides.readFile ?? (async (p) => files[p]),
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
    makeDirectory:
      overrides.makeDirectory ??
      (async (p) => {
        dirsCreated.push(p);
      }),
    listDirectory: overrides.listDirectory ?? (async () => []),
  };
}

const alwaysConfirm: ConfirmPackOverwrite = async () => true;
const neverConfirm: ConfirmPackOverwrite = async () => false;

describe('resolveExportTarget', () => {
  it('resolves a plain filename inside root', () => {
    expect(resolveExportTarget('/dest/ana', 'pack.json')).toBe(
      '/dest/ana/pack.json',
    );
  });

  it('resolves multiple segments jointly inside root', () => {
    expect(resolveExportTarget('/dest/ana', 'scripts', 'lib.lua')).toBe(
      '/dest/ana/scripts/lib.lua',
    );
  });

  it('rejects when any segment is unsafe, even with a safe segment alongside it', () => {
    expect(
      resolveExportTarget('/dest/ana', 'scripts', '../lib.lua'),
    ).toBeUndefined();
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
      expect(resolveExportTarget('/dest/ana', bad)).toBeUndefined();
    });
  }

  it('rejects a backslash-carrying segment', () => {
    expect(resolveExportTarget('/dest/ana', 'a\\b')).toBeUndefined();
  });

  it('rejects a traversal that only escapes via a combined segment list', () => {
    expect(resolveExportTarget('/dest/ana', 'a', '..', '..')).toBeUndefined();
  });

  it('rejects an empty segment list', () => {
    expect(resolveExportTarget('/dest/ana')).toBeUndefined();
  });
});

describe('exportPack', () => {
  const build: PackExportBuilder = async () => ({
    kind: 'built',
    scriptPath: '/cache/ana.js',
    warnings: [],
  });

  it('never touches the pack source folder: only pack.json/webview.js/scripts are read from it', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      '/packs/ana/pack.json': '{"name":"ana"}',
      '/cache/ana.js': '(script)',
    });

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    for (const writtenPath of fs.written.keys()) {
      expect(writtenPath.startsWith('/packs/ana')).toBe(false);
      expect(writtenPath.startsWith('/dest/ana/')).toBe(true);
    }
    expect(fs.deleted).toEqual([]);
  });

  it('writes pack.json verbatim, the script, and reports byte sizes', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      '/packs/ana/pack.json': '{"name":"ana","engine":"react"}',
      '/cache/ana.js': '(function(){})();',
    });

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.destinationFolder).toBe('/dest/ana');
    expect(outcome.manifestPath).toBe('/dest/ana/pack.json');
    expect(outcome.manifestBytes).toBe(
      Buffer.byteLength('{"name":"ana","engine":"react"}', 'utf8'),
    );
    expect(outcome.scriptPath).toBe('/dest/ana/webview.js');
    expect(outcome.scriptBytes).toBe(
      Buffer.byteLength('(function(){})();', 'utf8'),
    );
    expect(fs.written.get('/dest/ana/pack.json')).toBe(
      '{"name":"ana","engine":"react"}',
    );
    expect(fs.dirsCreated).toContain('/dest/ana');
  });

  it('writes a stylesheet when the build emits one', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      '/packs/ana/pack.json': '{}',
      '/cache/ana.js': 'script',
      '/cache/ana.css': '.ana-timeline{color:red}',
    });
    const buildWithCss: PackExportBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      stylesheetPath: '/cache/ana.css',
      warnings: [],
    });

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build: buildWithCss,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.stylesheetPath).toBe('/dest/ana/webview.css');
    expect(outcome.stylesheetBytes).toBe(
      Buffer.byteLength('.ana-timeline{color:red}', 'utf8'),
    );
  });

  it('removes a stale destination webview.css when the new build has no stylesheet', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs(
      {
        '/packs/ana/pack.json': '{}',
        '/cache/ana.js': 'script',
      },
      {
        exists: async (p) => p === '/dest/ana' || p === '/dest/ana/webview.css',
      },
    );

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.removedStylesheetPath).toBe('/dest/ana/webview.css');
    expect(fs.deleted).toEqual(['/dest/ana/webview.css']);
  });

  it('copies every .lua file from the pack scripts directory, ignoring non-lua entries', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs(
      {
        '/packs/ana/pack.json': '{}',
        '/cache/ana.js': 'script',
        '/packs/ana/scripts/lib.lua': 'return {}',
        '/packs/ana/scripts/helper.lua': 'return 1',
      },
      {
        listDirectory: async (dir) =>
          dir === '/packs/ana/scripts'
            ? ['lib.lua', 'helper.lua', 'README.md']
            : [],
      },
    );

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.scriptFilesCopied).toBe(2);
    expect(fs.written.get('/dest/ana/scripts/lib.lua')).toBe('return {}');
    expect(fs.written.get('/dest/ana/scripts/helper.lua')).toBe('return 1');
    expect(fs.written.has('/dest/ana/scripts/README.md')).toBe(false);
    expect(fs.dirsCreated).toContain('/dest/ana/scripts');
  });

  it('reports zero script files copied and creates no scripts folder when the pack has no scripts directory', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      '/packs/ana/pack.json': '{}',
      '/cache/ana.js': 'script',
    });

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.scriptFilesCopied).toBe(0);
    expect(fs.dirsCreated).not.toContain('/dest/ana/scripts');
  });

  it('asks confirmOverwrite once when the destination already holds files this export would replace', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs(
      { '/packs/ana/pack.json': '{}', '/cache/ana.js': 'script' },
      {
        exists: async (p) => p === '/dest/ana' || p === '/dest/ana/webview.js',
      },
    );
    const confirm: ConfirmPackOverwrite = vi.fn(async () => true);

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: confirm,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      packName: 'ana',
      existingPaths: ['/dest/ana/webview.js'],
    });
    expect(outcome.kind).toBe('written');
  });

  it('declined overwrite writes nothing and returns cancelled', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs(
      { '/packs/ana/pack.json': '{}', '/cache/ana.js': 'script' },
      {
        exists: async (p) => p === '/dest/ana' || p === '/dest/ana/webview.js',
      },
    );

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: neverConfirm,
    });

    expect(outcome).toEqual({ kind: 'cancelled', packName: 'ana' });
    expect(fs.written.size).toBe(0);
    expect(fs.dirsCreated).toEqual([]);
  });

  it('never asks confirmOverwrite when the destination folder does not exist yet', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      '/packs/ana/pack.json': '{}',
      '/cache/ana.js': 'script',
    });
    const confirm = vi.fn(async () => true);

    await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: confirm,
    });

    expect(confirm).not.toHaveBeenCalled();
  });

  it('passes a build failure reason through verbatim', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({ '/packs/ana/pack.json': '{}' });
    const failingBuild: PackExportBuilder = async () => ({
      kind: 'failed',
      reason: 'this install has no compiler; see docs',
    });

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build: failingBuild,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome).toEqual({
      kind: 'failed',
      packName: 'ana',
      reason: 'this install has no compiler; see docs',
    });
  });

  it('treats a skipped build outcome as a failure', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({ '/packs/ana/pack.json': '{}' });
    const skippedBuild: PackExportBuilder = async () => ({ kind: 'skipped' });

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build: skippedBuild,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failed');
    expect(outcome.reason).toContain('ana');
  });

  it('fails cleanly when pack.json cannot be read', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({ '/cache/ana.js': 'script' });

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind !== 'failed') throw new Error('expected failed');
    expect(outcome.reason).toContain('pack.json');
  });

  it('fails cleanly when the built script cannot be read back', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({ '/packs/ana/pack.json': '{}' });

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('failed');
  });

  it('an fs.writeFile that rejects comes back as failed rather than throwing', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs(
      { '/packs/ana/pack.json': '{}', '/cache/ana.js': 'script' },
      {
        writeFile: async () => {
          throw new Error('disk full');
        },
      },
    );

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
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

  it('passes build warnings through unchanged', async () => {
    const pack = packAt('/packs/ana');
    const fs = fakeFs({
      '/packs/ana/pack.json': '{}',
      '/cache/ana.js': 'script',
    });
    const buildWithWarnings: PackExportBuilder = async () => ({
      kind: 'built',
      scriptPath: '/cache/ana.js',
      warnings: ['pack "ana" CSS uses a raw color literal'],
    });

    const outcome = await exportPack({
      pack,
      cacheDir: '/cache',
      destinationDir: '/dest',
      exportName: 'ana',
      build: buildWithWarnings,
      fs,
      confirmOverwrite: alwaysConfirm,
    });

    expect(outcome.kind).toBe('written');
    if (outcome.kind !== 'written') throw new Error('expected written');
    expect(outcome.warnings).toEqual([
      'pack "ana" CSS uses a raw color literal',
    ]);
  });

  describe('hostile exportName', () => {
    for (const hostile of ['../evil', '/etc/evil', 'a/b', 'a\\b', '..', '.']) {
      it(`refuses ${JSON.stringify(hostile)} and writes nothing`, async () => {
        const pack = packAt('/packs/ana');
        const fs = fakeFs({
          '/packs/ana/pack.json': '{}',
          '/cache/ana.js': 'script',
        });

        const outcome = await exportPack({
          pack,
          cacheDir: '/cache',
          destinationDir: '/dest',
          exportName: hostile,
          build,
          fs,
          confirmOverwrite: alwaysConfirm,
        });

        expect(outcome.kind).toBe('failed');
        expect(fs.written.size).toBe(0);
        expect(fs.deleted).toEqual([]);
        expect(fs.dirsCreated).toEqual([]);
      });
    }
  });
});
