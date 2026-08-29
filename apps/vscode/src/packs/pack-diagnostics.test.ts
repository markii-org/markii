import { describe, expect, it } from 'vitest';
import {
  formatPackDiagnosticLines,
  formatPackRegistrationDiagnosticLines,
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
  prebuiltShadowedPacks: readonly { name: string; folder: string }[] = [],
): PackContext {
  return {
    packs,
    packModules: {},
    webviewPacks: packs,
    namespaces: packs.map((p) => p.manifest.name),
    skipped,
    relativeEntries,
    cssWarnings,
    prebuiltShadowedPacks,
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

  it('reports one informational line per workspace-relative markii.packs entry, naming the entry (ITEM 4)', () => {
    const lines = formatPackDiagnosticLines(context([], [], ['packs/demo']));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('packs/demo');
    expect(lines[0]).toContain('workspace-relative');
  });

  it('lists relative-entry lines after loaded and skipped lines', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [{ folder: '/packs/broken', reason: 'x' }],
        ['packs/demo'],
      ),
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('ana');
    expect(lines[1]).toContain('/packs/broken');
    expect(lines[2]).toContain('packs/demo');
  });

  it('lists pack CSS warnings last, after everything else', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [{ folder: '/packs/broken', reason: 'x' }],
        ['packs/demo'],
        ['pack "ana" CSS uses a raw color literal in "color: #fff;"'],
      ),
    );
    expect(lines).toHaveLength(4);
    expect(lines[3]).toContain('raw color literal');
  });

  it('an empty cssWarnings list contributes nothing', () => {
    const lines = formatPackDiagnosticLines(context([pack('ana', 1)], []));
    expect(lines).toHaveLength(1);
  });

  it("reports one informational line per prebuilt-shadowed pack, naming the pack and this host's export command", () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [],
        [],
        [],
        [{ name: 'ana', folder: '/packs/ana' }],
      ),
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('ana');
    expect(lines[1]).toContain('webview.js');
    expect(lines[1]).toContain('Export Pack');
  });

  it('lists prebuilt-shadow lines after relative-entry lines and before CSS warnings', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [{ folder: '/packs/broken', reason: 'x' }],
        ['packs/demo'],
        ['pack "ana" CSS uses a raw color literal in "color: #fff;"'],
        [{ name: 'ana', folder: '/packs/ana' }],
      ),
    );
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('ana');
    expect(lines[1]).toContain('/packs/broken');
    expect(lines[2]).toContain('packs/demo');
    expect(lines[3]).toContain('prebuilt webview.js');
    expect(lines[4]).toContain('raw color literal');
  });

  it('an empty prebuiltShadowedPacks list contributes nothing', () => {
    const lines = formatPackDiagnosticLines(context([pack('ana', 1)], []));
    expect(lines).toHaveLength(1);
  });
});

describe('formatPackRegistrationDiagnosticLines', () => {
  it('is empty when nothing was reported', () => {
    expect(
      formatPackRegistrationDiagnosticLines({
        invalidReasons: [],
        collisions: [],
        duplicateComposedNames: [],
      }),
    ).toEqual([]);
  });

  it('reports one line per invalid registration reason', () => {
    const lines = formatPackRegistrationDiagnosticLines({
      invalidReasons: [
        'pack registration #0 did not provide a manifest JSON string; ignored.',
      ],
      collisions: [],
      duplicateComposedNames: [],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('pack registration #0');
  });

  it('reports one summary line for a namespace collision, naming the shared namespace', () => {
    const lines = formatPackRegistrationDiagnosticLines({
      invalidReasons: [],
      collisions: ['demo'],
      duplicateComposedNames: [],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('demo');
    expect(lines[0]).toContain('share a namespace');
  });

  it('reports one line per duplicate-composed-name skip, naming both packs and the composed directive name, and saying the later component was skipped', () => {
    const lines = formatPackRegistrationDiagnosticLines({
      invalidReasons: [],
      collisions: [],
      duplicateComposedNames: [
        { composedName: 'demo_badge', keptPack: 'demo', skippedPack: 'demo2' },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('demo_badge');
    expect(lines[0]).toContain('"demo"');
    expect(lines[0]).toContain('"demo2"');
    expect(lines[0]).toContain('skipped');
  });

  it('the duplicate-composed-name line contains no em dash and no parentheses', () => {
    const [line] = formatPackRegistrationDiagnosticLines({
      invalidReasons: [],
      collisions: [],
      duplicateComposedNames: [
        { composedName: 'demo_badge', keptPack: 'demo', skippedPack: 'demo2' },
      ],
    });
    expect(line).toBeDefined();
    expect(line).not.toContain('—');
    expect(line).not.toContain('(');
    expect(line).not.toContain(')');
  });

  it('lists invalid-reason lines before collision lines before duplicate lines', () => {
    const lines = formatPackRegistrationDiagnosticLines({
      invalidReasons: ['pack registration #0 is malformed; ignored.'],
      collisions: ['demo'],
      duplicateComposedNames: [
        { composedName: 'demo_badge', keptPack: 'demo', skippedPack: 'demo2' },
      ],
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('registration #0');
    expect(lines[1]).toContain('share a namespace');
    expect(lines[2]).toContain('demo_badge');
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
