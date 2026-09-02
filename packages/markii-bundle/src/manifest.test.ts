import { describe, expect, it } from 'vitest';
import {
  createDefaultManifest,
  CURRENT_SPEC_VERSION,
  parseManifest,
} from './manifest';

describe('parseManifest — happy paths', () => {
  it('accepts a minimal valid manifest', () => {
    const result = parseManifest(JSON.stringify({ spec: '0.1.0' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.spec).toBe('0.1.0');
    expect(result.warnings).toEqual([]);
  });

  it('accepts a full manifest with permissions and uses', () => {
    const result = parseManifest(
      JSON.stringify({
        spec: '1.2.3',
        permissions: {
          net: { get: ['api.github.com'], post: ['hooks.example.com'] },
          bundle: ['read', 'write:.cache/'],
        },
        uses: ['ana'],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.permissions?.net?.get).toEqual(['api.github.com']);
    expect(result.manifest.permissions?.net?.post).toEqual([
      'hooks.example.com',
    ]);
    expect(result.manifest.permissions?.bundle).toEqual([
      'read',
      'write:.cache/',
    ]);
    expect(result.manifest.uses).toEqual(['ana']);
  });

  it('accepts prerelease/build semver', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '1.0.0-beta.1+build.5' }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a single-label net host (e.g. localhost)', () => {
    const result = parseManifest(
      JSON.stringify({
        spec: '0.1.0',
        permissions: { net: { get: ['localhost'] } },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a valid document field and preserves its value', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '0.1.0', document: 'docs/report.mk.md' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.document).toBe('docs/report.mk.md');
    expect(result.warnings).toEqual([]);
  });

  it('stays valid when document is absent (conventional note.mk.md applies)', () => {
    const result = parseManifest(JSON.stringify({ spec: '0.1.0' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.document).toBeUndefined();
  });

  it(
    'accepts a document value containing ../ as a string here — the ' +
      'consumer, not parseManifest, is the single path-jail point via ' +
      'normalizeBundlePath',
    () => {
      const result = parseManifest(
        JSON.stringify({ spec: '0.1.0', document: '../../etc/passwd' }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.manifest.document).toBe('../../etc/passwd');
    },
  );

  it('accepts an absolute-path document value as a string here for the same reason', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '0.1.0', document: '/etc/passwd' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.document).toBe('/etc/passwd');
  });
});

describe('parseManifest — errors', () => {
  it('rejects malformed JSON without throwing', () => {
    expect(() => parseManifest('{ not json')).not.toThrow();
    const result = parseManifest('{ not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/malformed JSON/);
  });

  it('rejects a JSON array root', () => {
    const result = parseManifest('[1, 2, 3]');
    expect(result.ok).toBe(false);
  });

  it('rejects a JSON primitive root', () => {
    const result = parseManifest('"just a string"');
    expect(result.ok).toBe(false);
  });

  it('rejects a null root', () => {
    const result = parseManifest('null');
    expect(result.ok).toBe(false);
  });

  it('rejects a manifest with neither spec nor mark', () => {
    const result = parseManifest(JSON.stringify({ uses: ['ana'] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/"spec" is required/);
  });

  it('rejects a non-semver spec field', () => {
    const result = parseManifest(JSON.stringify({ spec: 'v1' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/semver/);
  });

  it('rejects a spec field that is not a string', () => {
    const result = parseManifest(JSON.stringify({ spec: 1 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a host with a scheme', () => {
    const result = parseManifest(
      JSON.stringify({
        spec: '0.1.0',
        permissions: { net: { get: ['https://api.github.com'] } },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/bare hostnames/);
  });

  it('rejects a host with a port', () => {
    const result = parseManifest(
      JSON.stringify({
        spec: '0.1.0',
        permissions: { net: { get: ['api.github.com:443'] } },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a host with a path', () => {
    const result = parseManifest(
      JSON.stringify({
        spec: '0.1.0',
        permissions: { net: { get: ['api.github.com/x'] } },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a wildcard host', () => {
    const result = parseManifest(
      JSON.stringify({
        spec: '0.1.0',
        permissions: { net: { get: ['*.github.com'] } },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid bundle grant', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '0.1.0', permissions: { bundle: ['write:/'] } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/invalid grant/);
  });

  it('rejects the retired "write:cache/" spelling with a diagnostic naming "write:.cache/"', () => {
    const result = parseManifest(
      JSON.stringify({
        spec: '0.1.0',
        permissions: { bundle: ['write:cache/'] },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/retired grant "write:cache\/"/);
    expect(result.errors.join(' ')).toMatch(/"write:\.cache\/"/);
  });

  it('collects both a retired grant and an unrelated invalid grant as separate errors', () => {
    const result = parseManifest(
      JSON.stringify({
        spec: '0.1.0',
        permissions: { bundle: ['write:cache/', 'write:/'] },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /retired grant/.test(e))).toBe(true);
    expect(result.errors.some((e) => /invalid grant/.test(e))).toBe(true);
  });

  it('rejects permissions as a non-object', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '0.1.0', permissions: 'nope' }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects uses entries that are not strings', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '0.1.0', uses: [1, 2] }),
    );
    expect(result.ok).toBe(false);
  });

  it.each([
    ['a number', 1],
    ['an object', { path: 'x' }],
    ['an array', ['x']],
    ['null', null],
  ])('rejects a document field that is %s', (_label, document) => {
    const result = parseManifest(JSON.stringify({ spec: '0.1.0', document }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/"document" must be a string/);
  });

  it('collects multiple independent errors at once', () => {
    const result = parseManifest(JSON.stringify({ spec: 'bad', uses: [1] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('parseManifest — spec/mark compatibility', () => {
  it('accepts legacy "mark" with a warning, and carries the value as "spec"', () => {
    const result = parseManifest(JSON.stringify({ mark: '0.1.0' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.spec).toBe('0.1.0');
    expect(result.warnings.some((w) => /retired field name/.test(w))).toBe(
      true,
    );
  });

  it('rejects a non-semver legacy "mark" field', () => {
    const result = parseManifest(JSON.stringify({ mark: 'v1' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/"mark" must be a semver string/);
  });

  it('accepts "spec" with no warning when "mark" is absent', () => {
    const result = parseManifest(JSON.stringify({ spec: '0.1.0' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it('prefers "spec" and warns about the ignored "mark" when both are present', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '0.2.0', mark: '0.1.0' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.spec).toBe('0.2.0');
    expect(result.warnings.some((w) => /"mark" is ignored/.test(w))).toBe(true);
  });

  it('errors naming "spec" when neither field is present', () => {
    const result = parseManifest(JSON.stringify({ uses: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/"spec" is required/);
  });

  it('does not report legacy "mark" as an unknown top-level key', () => {
    const result = parseManifest(JSON.stringify({ mark: '0.1.0' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.warnings.some((w) => /unknown manifest key "mark"/.test(w)),
    ).toBe(false);
  });
});

describe('parseManifest — forward compatibility', () => {
  it('warns, but does not error, on unknown top-level keys', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '0.1.0', futureField: 'x' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes('futureField'))).toBe(true);
  });

  it('preserves unknown top-level keys on the returned manifest', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '0.1.0', futureField: { deep: true } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.futureField).toEqual({ deep: true });
  });

  it('produces no warnings when only known keys are present', () => {
    const result = parseManifest(
      JSON.stringify({ spec: '0.1.0', permissions: {}, uses: [] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });
});

describe('createDefaultManifest', () => {
  it('produces a manifest that itself parses as valid', () => {
    const manifest = createDefaultManifest('0.1.0');
    const result = parseManifest(JSON.stringify(manifest));
    expect(result.ok).toBe(true);
  });

  it('grants no permissions by default', () => {
    const manifest = createDefaultManifest('0.1.0');
    expect(manifest.permissions).toBeUndefined();
  });

  it('defaults to CURRENT_SPEC_VERSION when no version is passed', () => {
    const manifest = createDefaultManifest();
    expect(manifest.spec).toBe(CURRENT_SPEC_VERSION);
  });
});
