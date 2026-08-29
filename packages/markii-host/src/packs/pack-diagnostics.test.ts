import { describe, expect, it } from 'vitest';
import {
  formatPackDiagnosticLines,
  skippedPackCount,
} from './pack-diagnostics.js';
import type {
  PackDiagnosticsContext,
  PackDiagnosticsPack,
  PackDiagnosticsSkippedFolder,
} from './pack-diagnostics.js';

function pack(name: string, componentCount: number): PackDiagnosticsPack {
  const components: Record<string, string> = {};
  for (let i = 0; i < componentCount; i++)
    components[`c${i}`] = `src/c${i}.tsx`;
  return { manifest: { name, components } };
}

function context(
  packs: readonly PackDiagnosticsPack[],
  skipped: readonly PackDiagnosticsSkippedFolder[],
  relativeEntryLines: readonly string[] = [],
  cssWarnings: readonly string[] = [],
  invalidRegistrationReasons: readonly string[] = [],
  registrationCollisions: readonly string[] = [],
  prebuiltShadowLines: readonly string[] = [],
): PackDiagnosticsContext {
  return {
    packs,
    skipped,
    relativeEntryLines,
    prebuiltShadowLines,
    cssWarnings,
    invalidRegistrationReasons,
    registrationCollisions,
  };
}

describe('formatPackDiagnosticLines', () => {
  it('is empty for an empty pack context', () => {
    expect(formatPackDiagnosticLines(context([], []))).toEqual([]);
  });

  it('reports one line per loaded pack, naming name/namespace/component count', () => {
    const lines = formatPackDiagnosticLines(context([pack('ana', 3)], []));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('ana');
    expect(lines[0]).toContain('3');
  });

  it('reports one line per skipped folder, carrying the recorded reason', () => {
    const skipped: PackDiagnosticsSkippedFolder[] = [
      { folder: '/packs/broken', reason: 'invalid pack.json (missing name)' },
    ];
    const lines = formatPackDiagnosticLines(context([], skipped));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('/packs/broken');
    expect(lines[0]).toContain('invalid pack.json (missing name)');
  });

  it('lists loaded packs before skipped folders', () => {
    const lines = formatPackDiagnosticLines(
      context([pack('ana', 1)], [{ folder: '/packs/broken', reason: 'x' }]),
    );
    expect(lines[0]).toContain('ana');
    expect(lines[1]).toContain('/packs/broken');
  });

  it('splices in already-formatted relative-entry lines verbatim', () => {
    const lines = formatPackDiagnosticLines(
      context([], [], ['Deprecated: "packs/demo" is relative, ...']),
    );
    expect(lines).toEqual(['Deprecated: "packs/demo" is relative, ...']);
  });

  it('lists relative-entry lines after loaded and skipped lines', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [{ folder: '/packs/broken', reason: 'x' }],
        ['packs/demo is relative'],
      ),
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('ana');
    expect(lines[1]).toContain('/packs/broken');
    expect(lines[2]).toContain('packs/demo');
  });

  it('lists pack CSS warnings, then invalid-registration reasons, then a collision line, after everything else', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [{ folder: '/packs/broken', reason: 'x' }],
        ['packs/demo is relative'],
        ['pack "ana" CSS uses a raw color literal in "color: #fff;"'],
        [
          'pack registration #0 did not provide a manifest JSON string; ignored.',
        ],
        ['gh'],
      ),
    );
    expect(lines).toHaveLength(6);
    expect(lines[3]).toContain('raw color literal');
    expect(lines[4]).toContain('manifest JSON string');
    expect(lines[5]).toContain('gh');
    expect(lines[5]).toContain('namespace');
  });

  it('splices in prebuilt-shadow lines after relative-entry lines and before CSS warnings', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [{ folder: '/packs/broken', reason: 'x' }],
        ['packs/demo is relative'],
        ['pack "ana" CSS uses a raw color literal in "color: #fff;"'],
        [],
        [],
        [
          'Pack "ana" ships a prebuilt webview.js; its component sources on disk are ignored.',
        ],
      ),
    );
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('ana');
    expect(lines[1]).toContain('/packs/broken');
    expect(lines[2]).toContain('packs/demo');
    expect(lines[3]).toContain('prebuilt webview.js');
    expect(lines[4]).toContain('raw color literal');
  });

  it('omitting prebuiltShadowLines entirely contributes nothing', () => {
    const lines = formatPackDiagnosticLines({
      packs: [pack('ana', 1)],
      skipped: [],
      cssWarnings: [],
    });
    expect(lines).toHaveLength(1);
  });

  it('an empty cssWarnings/invalidRegistrationReasons/registrationCollisions list contributes nothing', () => {
    const lines = formatPackDiagnosticLines(context([pack('ana', 1)], []));
    expect(lines).toHaveLength(1);
  });

  it('omitting invalidRegistrationReasons/registrationCollisions entirely (not just empty) contributes nothing', () => {
    const lines = formatPackDiagnosticLines({
      packs: [pack('ana', 1)],
      skipped: [],
      cssWarnings: [],
    });
    expect(lines).toHaveLength(1);
  });
});

describe('skippedPackCount', () => {
  it('is zero when nothing failed', () => {
    expect(skippedPackCount(context([pack('ana', 1)], []))).toBe(0);
  });

  it('counts skipped folders', () => {
    const skipped: PackDiagnosticsSkippedFolder[] = [
      { folder: '/a', reason: 'x' },
      { folder: '/b', reason: 'y' },
    ];
    expect(skippedPackCount(context([], skipped))).toBe(2);
  });
});
