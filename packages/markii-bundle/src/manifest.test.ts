import { describe, expect, it } from 'vitest';
import {
  createDefaultManifest,
  CURRENT_SPEC_VERSION,
  parseManifest,
} from './manifest';

describe('parseManifest — happy paths', () => {
  it('accepts a minimal valid manifest', () => {
    const result = parseManifest(JSON.stringify({ mark: '0.1.0' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.mark).toBe('0.1.0');
    expect(result.warnings).toEqual([]);
  });

  it('accepts a full manifest with permissions and uses', () => {
    const result = parseManifest(
      JSON.stringify({
        mark: '1.2.3',
        permissions: {
          net: { get: ['api.github.com'], post: ['hooks.example.com'] },
          bundle: ['read', 'write:cache/'],
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
      'write:cache/',
    ]);
    expect(result.manifest.uses).toEqual(['ana']);
  });

  it('accepts prerelease/build semver', () => {
    const result = parseManifest(
      JSON.stringify({ mark: '1.0.0-beta.1+build.5' }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a single-label net host (e.g. localhost)', () => {
    const result = parseManifest(
      JSON.stringify({
        mark: '0.1.0',
        permissions: { net: { get: ['localhost'] } },
      }),
    );
    expect(result.ok).toBe(true);
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

  it('rejects a missing mark field', () => {
    const result = parseManifest(JSON.stringify({ uses: ['ana'] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/mark/);
  });

  it('rejects a non-semver mark field', () => {
    const result = parseManifest(JSON.stringify({ mark: 'v1' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/semver/);
  });

  it('rejects an mark field that is not a string', () => {
    const result = parseManifest(JSON.stringify({ mark: 1 }));
    expect(result.ok).toBe(false);
  });

  it('rejects a host with a scheme', () => {
    const result = parseManifest(
      JSON.stringify({
        mark: '0.1.0',
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
        mark: '0.1.0',
        permissions: { net: { get: ['api.github.com:443'] } },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a host with a path', () => {
    const result = parseManifest(
      JSON.stringify({
        mark: '0.1.0',
        permissions: { net: { get: ['api.github.com/x'] } },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a wildcard host', () => {
    const result = parseManifest(
      JSON.stringify({
        mark: '0.1.0',
        permissions: { net: { get: ['*.github.com'] } },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid bundle grant', () => {
    const result = parseManifest(
      JSON.stringify({ mark: '0.1.0', permissions: { bundle: ['write:/'] } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/invalid grant/);
  });

  it('rejects permissions as a non-object', () => {
    const result = parseManifest(
      JSON.stringify({ mark: '0.1.0', permissions: 'nope' }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects uses entries that are not strings', () => {
    const result = parseManifest(
      JSON.stringify({ mark: '0.1.0', uses: [1, 2] }),
    );
    expect(result.ok).toBe(false);
  });

  it('collects multiple independent errors at once', () => {
    const result = parseManifest(JSON.stringify({ mark: 'bad', uses: [1] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('parseManifest — forward compatibility', () => {
  it('warns, but does not error, on unknown top-level keys', () => {
    const result = parseManifest(
      JSON.stringify({ mark: '0.1.0', futureField: 'x' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes('futureField'))).toBe(true);
  });

  it('preserves unknown top-level keys on the returned manifest', () => {
    const result = parseManifest(
      JSON.stringify({ mark: '0.1.0', futureField: { deep: true } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.futureField).toEqual({ deep: true });
  });

  it('produces no warnings when only known keys are present', () => {
    const result = parseManifest(
      JSON.stringify({ mark: '0.1.0', permissions: {}, uses: [] }),
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
    expect(manifest.mark).toBe(CURRENT_SPEC_VERSION);
  });
});
