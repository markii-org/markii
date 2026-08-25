import { describe, expect, it } from 'vitest';
import { createRegistry } from '@markii/react';
import {
  formatPackDiagnosticLines,
  skippedPackCount,
} from './pack-diagnostics.js';
import type { DiscoveredPack, SkippedPackFolder } from '@markii/host';
import type { PackContext } from './pack-context.js';

function pack(name: string, componentCount: number): DiscoveredPack {
  const components: Record<string, string> = {};
  for (let i = 0; i < componentCount; i++)
    components[`c${i}`] = `src/c${i}.tsx`;
  return {
    folder: `/packs/${name}`,
    manifest: { name, engine: 'react', components },
    componentPaths: {},
    scriptsDir: `/packs/${name}/scripts`,
    scriptPath: `/packs/${name}/webview.js`,
  };
}

function context(
  packs: readonly DiscoveredPack[],
  skipped: readonly SkippedPackFolder[],
  relativeEntries: readonly string[] = [],
  cssWarnings: readonly string[] = [],
  invalidRegistrationReasons: readonly string[] = [],
  registrationCollisions: readonly string[] = [],
): PackContext {
  return {
    packs,
    packModules: {},
    registry: createRegistry(),
    stylesheets: [],
    namespaces: packs.map((p) => p.manifest.name),
    skipped,
    relativeEntries,
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
    const skipped: SkippedPackFolder[] = [
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

  it('reports one informational line per vault-relative pack-folder entry, naming the entry', () => {
    const lines = formatPackDiagnosticLines(context([], [], ['packs/demo']));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('packs/demo');
    expect(lines[0]).toContain('vault-relative');
  });

  it('lists pack CSS warnings, then invalid-registration reasons, then a collision line, after everything else', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [{ folder: '/packs/broken', reason: 'x' }],
        ['packs/demo'],
        ['pack "ana" CSS uses a raw color literal in "color: #fff;"'],
        [
          'pack registration #0 did not provide a manifest JSON string; ignored.',
        ],
        ['gh'],
      ),
    );
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('ana');
    expect(lines[1]).toContain('/packs/broken');
    expect(lines[2]).toContain('packs/demo');
    expect(lines[3]).toContain('raw color literal');
    expect(lines[4]).toContain('manifest JSON string');
    expect(lines[5]).toContain('gh');
    expect(lines[5]).toContain('namespace');
  });

  it('an empty cssWarnings/invalidRegistrationReasons/registrationCollisions list contributes nothing', () => {
    const lines = formatPackDiagnosticLines(context([pack('ana', 1)], []));
    expect(lines).toHaveLength(1);
  });
});

describe('skippedPackCount', () => {
  it('is zero when nothing failed', () => {
    expect(skippedPackCount(context([pack('ana', 1)], []))).toBe(0);
  });

  it('counts skipped folders', () => {
    const skipped: SkippedPackFolder[] = [
      { folder: '/a', reason: 'x' },
      { folder: '/b', reason: 'y' },
    ];
    expect(skippedPackCount(context([], skipped))).toBe(2);
  });
});
