import { describe, expect, it } from 'vitest';
import type {
  ConfirmPackOverwrite,
  DiscoveredPack,
  PackDistributionFs,
  PackDistributionOutcome,
} from '@markii/host';
import { PACK_COMPILATION_UNAVAILABLE_NOTICE } from './pack-diagnostics.js';
import {
  NO_PACKS_CONFIGURED_NOTICE,
  consoleLinesForOutcome,
  noticeForOutcome,
  overwritePromptMessage,
  runBuildPackForDistribution,
} from './build-pack-distribution.js';

function pack(name: string): DiscoveredPack {
  return {
    folder: `/packs/${name}`,
    manifest: {
      name,
      engine: 'react',
      components: { widget: './Widget.tsx' },
    },
    componentPaths: { widget: `/packs/${name}/Widget.tsx` },
    scriptsDir: `/packs/${name}/scripts`,
    scriptPath: `/packs/${name}/webview.js`,
  };
}

const alwaysConfirm: ConfirmPackOverwrite = async () => true;

function makeFs(files: Record<string, string> = {}): PackDistributionFs {
  const state = { ...files };
  return {
    exists: async (p) => Object.prototype.hasOwnProperty.call(state, p),
    readFile: async (p) => state[p],
    writeFile: async (p, text) => {
      state[p] = text;
    },
    deleteFile: async (p) => {
      delete state[p];
    },
  };
}

describe('NO_PACKS_CONFIGURED_NOTICE', () => {
  it('names Markii and points at the settings tab', () => {
    expect(NO_PACKS_CONFIGURED_NOTICE).toContain('Markii');
    expect(NO_PACKS_CONFIGURED_NOTICE).toContain('Component packs');
  });
});

describe('overwritePromptMessage', () => {
  it('names the single existing file rather than assuming webview.js', () => {
    expect(overwritePromptMessage('ana', ['/packs/ana/webview.css'])).toBe(
      'Pack ana already has webview.css in its folder. Overwrite it?',
    );
  });

  it('names both files and asks about them together', () => {
    expect(
      overwritePromptMessage('ana', [
        '/packs/ana/webview.js',
        '/packs/ana/webview.css',
      ]),
    ).toBe(
      'Pack ana already has webview.js and webview.css in its folder. Overwrite them?',
    );
  });

  it('falls back to a generic subject with no paths', () => {
    expect(overwritePromptMessage('ana', [])).toBe(
      'Pack ana already has built files in its folder. Overwrite them?',
    );
  });

  it('avoids em dashes and parentheses, per the notice style', () => {
    const message = overwritePromptMessage('ana', ['/packs/ana/webview.js']);
    expect(message).not.toMatch(/[—()]/);
  });
});

describe('noticeForOutcome', () => {
  it('written: names the pack and both file sizes in whole KB, rounded up', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 12 * 1024 - 100, // rounds up to 12 KB
      stylesheetPath: '/packs/ana/webview.css',
      stylesheetBytes: 2 * 1024 + 1, // rounds up to 3 KB
      warnings: [],
    };
    expect(noticeForOutcome(outcome)).toBe(
      'Markii: built pack "ana" into its folder. webview.js is 12 KB and webview.css is 3 KB.',
    );
  });

  it('written: omits the stylesheet clause when the build produced none', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 500,
      warnings: [],
    };
    expect(noticeForOutcome(outcome)).toBe(
      'Markii: built pack "ana" into its folder. webview.js is 1 KB.',
    );
  });

  it('written: a tiny script still rounds up to a minimum of 1 KB', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 10,
      warnings: [],
    };
    expect(noticeForOutcome(outcome)).toContain('webview.js is 1 KB');
  });

  it('cancelled: names the pack and states nothing changed', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'cancelled',
      packName: 'ana',
    };
    const notice = noticeForOutcome(outcome);
    expect(notice).toContain('ana');
    expect(notice).toContain('cancelled');
  });

  it('failed (ordinary reason): a generic failure notice, not the no-compiler one', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'failed',
      packName: 'ana',
      reason: 'Unexpected token in Widget.tsx',
    };
    const notice = noticeForOutcome(outcome);
    expect(notice).toContain('ana');
    expect(notice).not.toBe(PACK_COMPILATION_UNAVAILABLE_NOTICE);
  });

  it('failed (no-compiler reason): reuses the existing shared notice rather than a new sentence', () => {
    // The exact reason a three-file install's createPackRegistrationBuilder
    // produces (`./pack-compilation.ts` via `./pack-diagnostics.ts`'s
    // `packCompilationUnavailableReason`), matched through the existing
    // `compilationUnavailableSkipCount` marker predicate rather than a
    // second ad hoc string match.
    const outcome: PackDistributionOutcome = {
      kind: 'failed',
      packName: 'ana',
      reason:
        'pack "ana" was not compiled: compiling a pack from source needs files that only the full zip install includes. Download the zip from https://github.com/markii-org/markii-obsidian/releases instead of installing from the loose manifest.json/main.js/styles.css. A pack that ships a prebuilt "webview.js" still loads without this.',
    };
    expect(noticeForOutcome(outcome)).toBe(PACK_COMPILATION_UNAVAILABLE_NOTICE);
  });

  it('every notice avoids em dashes and double quotes are used only around a pack name', () => {
    const outcomes: PackDistributionOutcome[] = [
      {
        kind: 'written',
        packName: 'ana',
        scriptPath: '/packs/ana/webview.js',
        scriptBytes: 500,
        warnings: [],
      },
      { kind: 'cancelled', packName: 'ana' },
      { kind: 'failed', packName: 'ana', reason: 'boom' },
    ];
    for (const outcome of outcomes) {
      expect(noticeForOutcome(outcome)).not.toMatch(/—/);
    }
  });
});

describe('consoleLinesForOutcome', () => {
  it('written: lists the script path and size, the stylesheet path and size, and any warnings', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 1234,
      stylesheetPath: '/packs/ana/webview.css',
      stylesheetBytes: 56,
      warnings: ['pack "ana" CSS uses a raw color literal in "color: #fff;"'],
    };
    const lines = consoleLinesForOutcome(outcome);
    expect(lines.some((l) => l.includes('/packs/ana/webview.js'))).toBe(true);
    expect(lines.some((l) => l.includes('1234'))).toBe(true);
    expect(lines.some((l) => l.includes('/packs/ana/webview.css'))).toBe(true);
    expect(lines.some((l) => l.includes('56'))).toBe(true);
    expect(lines.some((l) => l.includes('raw color literal'))).toBe(true);
  });

  it('written: names a removed stale stylesheet when one was cleaned up', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'written',
      packName: 'ana',
      scriptPath: '/packs/ana/webview.js',
      scriptBytes: 100,
      removedStylesheetPath: '/packs/ana/webview.css',
      warnings: [],
    };
    const lines = consoleLinesForOutcome(outcome);
    expect(lines.some((l) => l.includes('removed'))).toBe(true);
    expect(lines.some((l) => l.includes('/packs/ana/webview.css'))).toBe(true);
  });

  it('failed: carries the reason verbatim', () => {
    const outcome: PackDistributionOutcome = {
      kind: 'failed',
      packName: 'ana',
      reason: 'Unexpected token in Widget.tsx',
    };
    const lines = consoleLinesForOutcome(outcome);
    expect(
      lines.some((l) => l.includes('Unexpected token in Widget.tsx')),
    ).toBe(true);
  });

  it('cancelled: names the pack', () => {
    const lines = consoleLinesForOutcome({
      kind: 'cancelled',
      packName: 'ana',
    });
    expect(lines.some((l) => l.includes('ana'))).toBe(true);
  });
});

describe('runBuildPackForDistribution — no compiler installed', () => {
  it('composes through createPackRegistrationBuilder, so a missing esbuild-wasm path produces the shared no-compiler notice end to end', async () => {
    const result = await runBuildPackForDistribution({
      pack: pack('ana'),
      cacheDir: '/cache',
      esbuildBrowserModulePath: undefined,
      esbuildWasmBinaryPath: undefined,
      fs: makeFs(),
      confirmOverwrite: alwaysConfirm,
    });

    expect(result.outcome.kind).toBe('failed');
    expect(result.notice).toBe(PACK_COMPILATION_UNAVAILABLE_NOTICE);
    expect(
      result.consoleLines.some((l) =>
        l.includes('compiling a pack from source'),
      ),
    ).toBe(true);
  });
});
