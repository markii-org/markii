import { describe, expect, it } from 'vitest';
import { createRegistry } from '@markii/react';
import {
  PACK_COMPILATION_UNAVAILABLE_NOTICE,
  compilationUnavailableSkipCount,
  formatPackDiagnosticLines,
  hasPackCompilationUnavailable,
  packCollisionNotice,
  packCompilationUnavailableReason,
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
  relativeEntries: readonly string[] = [],
  cssWarnings: readonly string[] = [],
  invalidRegistrationReasons: readonly string[] = [],
  registrationCollisions: readonly string[] = [],
  prebuiltShadowedPacks: readonly {
    readonly name: string;
    readonly folder: string;
  }[] = [],
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

  it('reports one informational line per prebuilt pack that shadows component sources, naming the pack', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [],
        [],
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

  it('the shadow line sits between the relative-entry lines and the CSS warnings', () => {
    const lines = formatPackDiagnosticLines(
      context(
        [pack('ana', 1)],
        [],
        ['packs/demo'],
        ['pack "ana" CSS uses a raw color literal in "color: #fff;"'],
        [],
        [],
        [{ name: 'ana', folder: '/packs/ana' }],
      ),
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('ana');
    expect(lines[1]).toContain('vault-relative');
    expect(lines[2]).toContain('prebuilt');
    expect(lines[3]).toContain('raw color literal');
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

describe('packCompilationUnavailableReason', () => {
  it('names the pack and points at the releases URL', () => {
    const reason = packCompilationUnavailableReason('ana');
    expect(reason).toContain('ana');
    expect(reason).toContain(
      'https://github.com/markii-org/markii-obsidian/releases',
    );
  });
});

describe('hasPackCompilationUnavailable', () => {
  it('is true for a context carrying the pack-compilation-unavailable reason', () => {
    const skipped: SkippedPackFolder[] = [
      { folder: '/packs/ana', reason: packCompilationUnavailableReason('ana') },
    ];
    expect(hasPackCompilationUnavailable(context([], skipped))).toBe(true);
  });

  it('is false for a context carrying an unrelated skipped reason', () => {
    const skipped: SkippedPackFolder[] = [
      { folder: '/packs/broken', reason: 'invalid pack.json (missing name)' },
    ];
    expect(hasPackCompilationUnavailable(context([], skipped))).toBe(false);
  });

  it('is false for an empty context', () => {
    expect(hasPackCompilationUnavailable(context([], []))).toBe(false);
  });
});

describe('compilationUnavailableSkipCount', () => {
  it('counts only the no-compiler skips, not other failures', () => {
    const skipped: SkippedPackFolder[] = [
      { folder: '/packs/ana', reason: packCompilationUnavailableReason('ana') },
      { folder: '/packs/bob', reason: packCompilationUnavailableReason('bob') },
      { folder: '/packs/broken', reason: 'invalid pack.json (missing name)' },
    ];
    expect(compilationUnavailableSkipCount(context([], skipped))).toBe(2);
  });
});

describe('notice wording', () => {
  const notices = [
    PACK_COMPILATION_UNAVAILABLE_NOTICE,
    packLoadFailureNotice(1),
    packLoadFailureNotice(3),
    packCollisionNotice(['ana', 'bob']),
  ];

  it('pluralizes the load-failure notice', () => {
    expect(packLoadFailureNotice(1)).toContain('a pack failed');
    expect(packLoadFailureNotice(3)).toContain('3 packs failed');
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
