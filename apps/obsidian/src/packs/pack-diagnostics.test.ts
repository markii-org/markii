import { describe, expect, it } from 'vitest';
import { createRegistry } from '@markii/react';
import {
  notEnabledPackLine,
  packEnabledNotice,
  packRemoveFolderFailedNotice,
  packRemovedNotice,
  formatPackDiagnosticLines,
  packCollisionNotice,
  packLoadFailureNotice,
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
  invalidRegistrationReasons: readonly string[] = [],
  registrationCollisions: readonly string[] = [],
  prebuiltShadowedPacks: readonly {
    readonly name: string;
    readonly folder: string;
  }[] = [],
  duplicateComposedNames: readonly {
    readonly composedName: string;
    readonly keptPack: string;
    readonly skippedPack: string;
  }[] = [],
): PackContext {
  return {
    packs,
    packModules: {},
    registry: createRegistry(),
    stylesheets: [],
    namespaces: packs.map((p) => p.manifest.name),
    skipped,
    invalidRegistrationReasons,
    registrationCollisions,
    prebuiltShadowedPacks,
    duplicateComposedNames,
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

  it('lists invalid-registration reasons then a collision line, after everything else', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [{ folder: '/packs/broken', reason: 'x' }],
        [
          'pack registration #0 did not provide a manifest JSON string; ignored.',
        ],
        ['gh'],
      ),
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('ana');
    expect(lines[1]).toContain('/packs/broken');
    expect(lines[2]).toContain('manifest JSON string');
    expect(lines[3]).toContain('gh');
    expect(lines[3]).toContain('namespace');
  });

  it('reports one line per duplicate composed name, naming both packs, after the collision line', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [],
        [],
        [],
        [],
        [{ composedName: 'a_widget', keptPack: 'a', skippedPack: 'a-2' }],
      ),
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('a_widget');
    expect(lines[1]).toContain('"a-2"');
    expect(lines[1]).toContain('"a"');
  });

  it('an empty invalidRegistrationReasons/registrationCollisions list contributes nothing', () => {
    const lines = formatPackDiagnosticLines(context([pack('ana', 1)], []));
    expect(lines).toHaveLength(1);
  });

  it('reports one informational line per prebuilt pack that shadows component sources, naming the pack', () => {
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
    expect(lines[1]).toContain('prebuilt');
    expect(lines[1]).toContain('webview.js');
  });

  it('is absent when no pack shadows anything', () => {
    const lines = formatPackDiagnosticLines(context([pack('ana', 1)], []));
    expect(lines.some((line) => line.includes('prebuilt'))).toBe(false);
  });

  it('does not affect skippedPackCount', () => {
    const withShadow = context(
      [pack('ana', 1)],
      [],
      [],
      [],
      [{ name: 'ana', folder: '/packs/ana' }],
    );
    expect(skippedPackCount(withShadow)).toBe(0);
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

describe('notEnabledPackLine', () => {
  it('names the namespace and points at the settings tab', () => {
    const line = notEnabledPackLine('read');
    expect(line).toContain('read');
    expect(line).toContain('not enabled');
    expect(line).toContain('Component packs');
  });
});

describe('notice wording', () => {
  const notices = [
    packLoadFailureNotice(1),
    packLoadFailureNotice(3),
    packCollisionNotice(['ana', 'bob']),
    packRemovedNotice('ana'),
    packRemoveFolderFailedNotice('ana'),
    packEnabledNotice('ana'),
  ];

  it('pluralizes the load-failure notice', () => {
    expect(packLoadFailureNotice(1)).toContain('a pack failed');
    expect(packLoadFailureNotice(3)).toContain('3 packs failed');
  });

  it('says a removed pack no longer loads even when its folder survived', () => {
    expect(packRemovedNotice('ana')).toContain('removed the pack ana');
    const failed = packRemoveFolderFailedNotice('ana');
    expect(failed).toContain('no longer loads');
    expect(failed).toContain('could not be deleted');
  });

  it('names the pack it enabled', () => {
    expect(packEnabledNotice('ana')).toContain('enabled the pack ana');
  });

  it('names the colliding namespaces', () => {
    expect(packCollisionNotice(['ana', 'bob'])).toContain('ana, bob');
  });

  // Notice style (user-set 2026-08-29): short, plain sentences. What went
  // wrong, then what to do. No em dashes, no parentheses, no quoted command
  // names; detail belongs in the console diagnostics, not the notice.
  it('keeps every notice short and free of em dashes, parentheses, and quotes', () => {
    for (const notice of notices) {
      expect(notice).not.toMatch(/[—()"]/);
      expect(notice.length).toBeLessThan(120);
    }
  });
});
