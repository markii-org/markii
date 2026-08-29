import { describe, expect, it } from 'vitest';
import {
  NO_PACKS_CONFIGURED_MESSAGE,
  packDistributionQuickPickItem,
  packDistributionDiagnosticLines,
  packDistributionResultMessage,
  packOverwriteConfirmMessage,
} from './build-pack-distribution.js';
import type { DiscoveredPack, PackDistributionOutcome } from '@markii/host';

function pack(name: string, folder: string): DiscoveredPack {
  return {
    folder,
    manifest: { name, engine: 'react', components: { widget: './Widget.tsx' } },
    componentPaths: { widget: `${folder}/Widget.tsx` },
    scriptsDir: `${folder}/scripts`,
    scriptPath: `${folder}/webview.js`,
  };
}

describe('packDistributionQuickPickItem', () => {
  it('uses the pack name as label and the folder as description', () => {
    expect(packDistributionQuickPickItem(pack('ana', '/packs/ana'))).toEqual({
      label: 'ana',
      description: '/packs/ana',
    });
  });
});

describe('packOverwriteConfirmMessage', () => {
  it('uses singular wording for exactly one existing path', () => {
    const message = packOverwriteConfirmMessage({
      packName: 'ana',
      existingPaths: ['/packs/ana/webview.js'],
    });
    expect(message).toContain('ana');
    expect(message).toContain('a prebuilt file');
    expect(message).toContain('Overwrite it?');
    expect(message).not.toContain('--');
  });

  it('uses plural wording for more than one existing path', () => {
    const message = packOverwriteConfirmMessage({
      packName: 'ana',
      existingPaths: ['/packs/ana/webview.js', '/packs/ana/webview.css'],
    });
    expect(message).toContain('prebuilt files');
    expect(message).toContain('Overwrite them?');
  });
});

describe('packDistributionResultMessage', () => {
  it('names both files and their sizes on a written outcome with a stylesheet', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 12_000,
      stylesheetPath: '/packs/ana/webview.css',
      stylesheetBytes: 3_000,
      warnings: [],
    };
    const message = packDistributionResultMessage(outcome);
    expect(message).toBe(
      'Markii: built pack "ana" into its folder. webview.js is 12 KB and webview.css is 3 KB.',
    );
  });

  it('omits the stylesheet clause when the build produced no stylesheet', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 12_000,
      warnings: [],
    };
    const message = packDistributionResultMessage(outcome);
    expect(message).toBe(
      'Markii: built pack "ana" into its folder. webview.js is 12 KB.',
    );
  });

  it('rounds a byte count under 1024 up to a minimum of 1 KB', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 500,
      warnings: [],
    };
    expect(packDistributionResultMessage(outcome)).toContain('1 KB');
  });

  it('rounds a byte count up to the next whole kilobyte', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 1025,
      warnings: [],
    };
    expect(packDistributionResultMessage(outcome)).toContain('2 KB');
  });

  it('reports a cancelled outcome by name', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'cancelled',
      packName: 'ana',
    };
    expect(packDistributionResultMessage(outcome)).toBe(
      'Markii: build cancelled for pack "ana". Nothing was written.',
    );
  });

  it('keeps a failure reason out of the popup and points at the output channel', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'failed',
      packName: 'ana',
      reason: 'esbuild-wasm could not be loaded\n  at some/very/long/stack',
    };
    const message = packDistributionResultMessage(outcome);
    expect(message).toBe(
      'Markii: could not build pack "ana". Open the Markii output for details.',
    );
    expect(message).not.toContain('esbuild-wasm');
  });
});

describe('packDistributionDiagnosticLines', () => {
  it('carries a failure reason verbatim, however long', () => {
    const reason =
      'esbuild-wasm could not be loaded\n  at some/very/long/stack';
    expect(
      packDistributionDiagnosticLines({
        kind: 'failed',
        packName: 'ana',
        reason,
      }),
    ).toEqual([`Build for distribution failed for pack "ana": ${reason}`]);
  });

  it('records both written paths, their byte sizes, and any warnings', () => {
    const lines = packDistributionDiagnosticLines({
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 2048,
      stylesheetPath: '/packs/ana/webview.css',
      stylesheetBytes: 512,
      warnings: ['ana: raw color literal in .mk-ana-timeline'],
    });
    expect(lines[0]).toContain('/packs/ana/webview.js');
    expect(lines[0]).toContain('2048 bytes');
    expect(lines[1]).toContain('/packs/ana/webview.css');
    expect(lines).toContain('ana: raw color literal in .mk-ana-timeline');
  });

  it('records a stale stylesheet that was removed', () => {
    const lines = packDistributionDiagnosticLines({
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 100,
      removedStylesheetPath: '/packs/ana/webview.css',
      warnings: [],
    });
    expect(lines.some((line) => line.includes('Removed stale'))).toBe(true);
  });

  it('records a cancelled run as nothing written', () => {
    expect(
      packDistributionDiagnosticLines({ kind: 'cancelled', packName: 'ana' }),
    ).toEqual([
      'Build for distribution cancelled for pack "ana"; nothing was written.',
    ]);
  });
});

describe('NO_PACKS_CONFIGURED_MESSAGE', () => {
  it('names the Add Pack Folder command', () => {
    expect(NO_PACKS_CONFIGURED_MESSAGE).toContain('Add Pack Folder');
  });
});
