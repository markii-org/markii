import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  NO_PACKS_CONFIGURED_MESSAGE,
  packArchiveExportDiagnosticLines,
  packArchiveExportResultMessage,
  packExportQuickPickItem,
  writePackArchiveFile,
} from './export-pack.js';
import type { DiscoveredPack, PackExportArchiveOutcome } from '@markii/host';

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

describe('NO_PACKS_CONFIGURED_MESSAGE', () => {
  it('names the Add Pack Folder command', () => {
    expect(NO_PACKS_CONFIGURED_MESSAGE).toContain('Add Pack Folder');
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

describe('writePackArchiveFile', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('writes bytes to a nested destination that did not exist before', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'markii-export-archive-'));
    tempDirs.push(dir);
    const target = path.join(dir, 'nested', 'ana-1.0.0.mkp');

    await expect(access(target)).rejects.toThrow();
    await writePackArchiveFile(target, new Uint8Array([1, 2, 3]));
    const written = await readFile(target);
    expect([...written]).toEqual([1, 2, 3]);
    await expect(access(target)).resolves.toBeUndefined();
  });
});
