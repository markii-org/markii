import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  archiveExportNameValidationMessage,
  archiveFileExists,
  exportNameValidationMessage,
  NO_PACKS_CONFIGURED_MESSAGE,
  normalizeArchiveExportName,
  packArchiveExportDiagnosticLines,
  packArchiveExportResultMessage,
  packArchiveOverwriteConfirmMessage,
  PACK_EXPORT_FORMAT_ITEMS,
  packExportDiagnosticLines,
  packExportOverwriteConfirmMessage,
  packExportQuickPickItem,
  packExportResultMessage,
  writePackArchiveFile,
} from './export-pack.js';
import type {
  DiscoveredPack,
  PackExportArchiveOutcome,
  PackExportOutcome,
} from '@markii/host';

function pack(name: string, folder: string): DiscoveredPack {
  return {
    folder,
    manifest: { name, engine: 'react', components: { widget: './Widget.tsx' } },
    componentPaths: { widget: `${folder}/Widget.tsx` },
    scriptsDir: `${folder}/scripts`,
    scriptPath: `${folder}/webview.js`,
  };
}

describe('packExportQuickPickItem', () => {
  it('uses the pack name as label and the folder as description', () => {
    expect(packExportQuickPickItem(pack('ana', '/packs/ana'))).toEqual({
      label: 'ana',
      description: '/packs/ana',
    });
  });
});

describe('exportNameValidationMessage', () => {
  it('accepts a plain name', () => {
    expect(exportNameValidationMessage('ana')).toBeUndefined();
  });

  it('rejects an empty name', () => {
    expect(exportNameValidationMessage('')).toBeDefined();
  });

  it('rejects a whitespace-only name', () => {
    expect(exportNameValidationMessage('   ')).toBeDefined();
  });

  it('rejects "."', () => {
    expect(exportNameValidationMessage('.')).toBeDefined();
  });

  it('rejects ".."', () => {
    expect(exportNameValidationMessage('..')).toBeDefined();
  });

  it('rejects a name containing a forward slash', () => {
    expect(exportNameValidationMessage('a/b')).toBeDefined();
  });

  it('rejects a name containing a backslash', () => {
    expect(exportNameValidationMessage('a\\b')).toBeDefined();
  });
});

describe('packExportOverwriteConfirmMessage', () => {
  it('uses singular wording for exactly one existing path', () => {
    const message = packExportOverwriteConfirmMessage({
      packName: 'ana',
      existingPaths: ['/dest/ana/webview.js'],
    });
    expect(message).toContain('ana');
    expect(message).toContain('a file');
    expect(message).toContain('Overwrite it?');
    expect(message).not.toContain('--');
    expect(message).not.toContain('(');
  });

  it('uses plural wording for more than one existing path', () => {
    const message = packExportOverwriteConfirmMessage({
      packName: 'ana',
      existingPaths: ['/dest/ana/webview.js', '/dest/ana/webview.css'],
    });
    expect(message).toContain('files');
    expect(message).toContain('Overwrite them?');
  });
});

describe('packExportResultMessage', () => {
  it('names the destination folder and both files with their sizes', () => {
    const outcome: PackExportOutcome = {
      kind: 'written',
      packName: 'ana',
      destinationFolder: '/home/user/exports/ana',
      manifestPath: '/home/user/exports/ana/pack.json',
      manifestBytes: 40,
      scriptPath: '/home/user/exports/ana/webview.js',
      scriptBytes: 12_000,
      stylesheetPath: '/home/user/exports/ana/webview.css',
      stylesheetBytes: 2_000,
      scriptFilesCopied: 0,
      warnings: [],
    };
    const message = packExportResultMessage(outcome);
    expect(message).toBe(
      'Markii: exported pack "ana" to /home/user/exports/ana. webview.js is 12 KB and webview.css is 2 KB.',
    );
    expect(message).not.toContain('(');
    expect(message).not.toContain('--');
  });

  it('omits the stylesheet clause when the build produced no stylesheet', () => {
    const outcome: PackExportOutcome = {
      kind: 'written',
      packName: 'ana',
      destinationFolder: '/dest/ana',
      manifestPath: '/dest/ana/pack.json',
      manifestBytes: 10,
      scriptPath: '/dest/ana/webview.js',
      scriptBytes: 12_000,
      scriptFilesCopied: 0,
      warnings: [],
    };
    expect(packExportResultMessage(outcome)).toBe(
      'Markii: exported pack "ana" to /dest/ana. webview.js is 12 KB.',
    );
  });

  it('rounds a byte count under 1024 up to a minimum of 1 KB', () => {
    const outcome: PackExportOutcome = {
      kind: 'written',
      packName: 'ana',
      destinationFolder: '/dest/ana',
      manifestPath: '/dest/ana/pack.json',
      manifestBytes: 10,
      scriptPath: '/dest/ana/webview.js',
      scriptBytes: 500,
      scriptFilesCopied: 0,
      warnings: [],
    };
    expect(packExportResultMessage(outcome)).toContain('1 KB');
  });

  it('reports a cancelled outcome by name', () => {
    const outcome: PackExportOutcome = { kind: 'cancelled', packName: 'ana' };
    expect(packExportResultMessage(outcome)).toBe(
      'Markii: export cancelled for pack "ana". Nothing was written.',
    );
  });

  it('keeps a failure reason out of the popup and points at the output channel', () => {
    const outcome: PackExportOutcome = {
      kind: 'failed',
      packName: 'ana',
      reason: 'esbuild-wasm could not be loaded\n  at some/very/long/stack',
    };
    const message = packExportResultMessage(outcome);
    expect(message).toBe(
      'Markii: could not export pack "ana". Open the Markii output for details.',
    );
    expect(message).not.toContain('esbuild-wasm');
  });
});

describe('packExportDiagnosticLines', () => {
  it('carries a failure reason verbatim, however long', () => {
    const reason =
      'esbuild-wasm could not be loaded\n  at some/very/long/stack';
    expect(
      packExportDiagnosticLines({ kind: 'failed', packName: 'ana', reason }),
    ).toEqual([`Export failed for pack "ana": ${reason}`]);
  });

  it('records the manifest, script, and stylesheet paths with byte sizes, plus warnings', () => {
    const lines = packExportDiagnosticLines({
      kind: 'written',
      packName: 'ana',
      destinationFolder: '/dest/ana',
      manifestPath: '/dest/ana/pack.json',
      manifestBytes: 40,
      scriptPath: '/dest/ana/webview.js',
      scriptBytes: 2048,
      stylesheetPath: '/dest/ana/webview.css',
      stylesheetBytes: 512,
      scriptFilesCopied: 2,
      warnings: ['ana: raw color literal in .mk-ana-timeline'],
    });
    expect(lines.some((line) => line.includes('/dest/ana/pack.json'))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes('/dest/ana/webview.js'))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes('2048 bytes'))).toBe(true);
    expect(lines.some((line) => line.includes('/dest/ana/webview.css'))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes('copied 2 script files'))).toBe(
      true,
    );
    expect(lines).toContain('ana: raw color literal in .mk-ana-timeline');
  });

  it('records a stale stylesheet that was removed', () => {
    const lines = packExportDiagnosticLines({
      kind: 'written',
      packName: 'ana',
      destinationFolder: '/dest/ana',
      manifestPath: '/dest/ana/pack.json',
      manifestBytes: 10,
      scriptPath: '/dest/ana/webview.js',
      scriptBytes: 100,
      removedStylesheetPath: '/dest/ana/webview.css',
      scriptFilesCopied: 0,
      warnings: [],
    });
    expect(lines.some((line) => line.includes('Removed stale'))).toBe(true);
  });

  it('records a cancelled run as nothing written', () => {
    expect(
      packExportDiagnosticLines({ kind: 'cancelled', packName: 'ana' }),
    ).toEqual(['Export cancelled for pack "ana"; nothing was written.']);
  });
});

describe('NO_PACKS_CONFIGURED_MESSAGE', () => {
  it('names the Add Pack Folder command', () => {
    expect(NO_PACKS_CONFIGURED_MESSAGE).toContain('Add Pack Folder');
  });
});

describe('PACK_EXPORT_FORMAT_ITEMS', () => {
  it('offers exactly a folder choice and an archive choice', () => {
    expect(PACK_EXPORT_FORMAT_ITEMS.map((item) => item.format)).toEqual([
      'folder',
      'archive',
    ]);
  });
});

describe('normalizeArchiveExportName / archiveExportNameValidationMessage', () => {
  it('appends .mkp when the user left it off', () => {
    expect(normalizeArchiveExportName('ana')).toBe('ana.mkp');
  });

  it('leaves an already-.mkp name alone, case-insensitively', () => {
    expect(normalizeArchiveExportName('ana.MKP')).toBe('ana.MKP');
  });

  it('rejects an empty name, ".", "..", and a path separator', () => {
    expect(archiveExportNameValidationMessage('')).toBeDefined();
    expect(archiveExportNameValidationMessage('.')).toBeDefined();
    expect(archiveExportNameValidationMessage('..')).toBeDefined();
    expect(archiveExportNameValidationMessage('sub/ana.mkp')).toBeDefined();
    expect(archiveExportNameValidationMessage('sub\\ana.mkp')).toBeDefined();
  });

  it('accepts a plain name', () => {
    expect(archiveExportNameValidationMessage('ana.mkp')).toBeUndefined();
  });
});

describe('packArchiveOverwriteConfirmMessage', () => {
  it('names both the existing file and the pack', () => {
    const message = packArchiveOverwriteConfirmMessage({
      packName: 'ana',
      fileName: 'ana-1.0.0.mkp',
    });
    expect(message).toContain('ana-1.0.0.mkp');
    expect(message).toContain('ana');
  });
});

describe('packArchiveExportResultMessage / packArchiveExportDiagnosticLines', () => {
  const built: PackExportArchiveOutcome = {
    kind: 'built',
    packName: 'ana',
    fileName: 'ana-1.0.0.mkp',
    bytes: new Uint8Array(2048),
    scriptBytes: 1500,
    stylesheetBytes: 400,
    scriptFilesCopied: 1,
    warnings: ['ana: raw color literal'],
  };
  const failed: PackExportArchiveOutcome = {
    kind: 'failed',
    packName: 'ana',
    reason: 'esbuild exploded in a very long multi-line way',
  };

  it('a successful result names the destination and size, without the failure reason ever appearing', () => {
    const message = packArchiveExportResultMessage(
      built,
      '/dest/ana-1.0.0.mkp',
    );
    expect(message).toContain('/dest/ana-1.0.0.mkp');
    expect(message).not.toContain('—');
    expect(message).not.toContain('(');
  });

  it('a failure keeps its reason out of the popup and directs to the output channel', () => {
    const message = packArchiveExportResultMessage(failed, '/dest/ana.mkp');
    expect(message).not.toContain('esbuild exploded');
    expect(message).toContain('Markii output');
  });

  it('diagnostics carry the failure reason verbatim and the archive byte sizes', () => {
    const failLines = packArchiveExportDiagnosticLines(failed, '/dest/ana.mkp');
    expect(failLines.join('\n')).toContain(
      'esbuild exploded in a very long multi-line way',
    );

    const builtLines = packArchiveExportDiagnosticLines(
      built,
      '/dest/ana-1.0.0.mkp',
    );
    expect(builtLines.join('\n')).toContain('/dest/ana-1.0.0.mkp');
    expect(builtLines.join('\n')).toContain('webview.js 1500 bytes');
    expect(builtLines.join('\n')).toContain('webview.css 400 bytes');
    expect(builtLines).toContain('ana: raw color literal');
  });
});

describe('writePackArchiveFile / archiveFileExists', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('writes bytes to a nested destination and reports existence correctly', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'markii-export-archive-'));
    tempDirs.push(dir);
    const target = path.join(dir, 'nested', 'ana-1.0.0.mkp');

    expect(await archiveFileExists(target)).toBe(false);
    await writePackArchiveFile(target, new Uint8Array([1, 2, 3]));
    expect(await archiveFileExists(target)).toBe(true);
    const written = await readFile(target);
    expect([...written]).toEqual([1, 2, 3]);
    await expect(access(target)).resolves.toBeUndefined();
  });
});
