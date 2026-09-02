import { describe, expect, it } from 'vitest';
import { isWriteAllowed, normalizeBundlePath } from './paths';

function reason(path: string): string {
  const result = normalizeBundlePath(path);
  if (result.ok)
    throw new Error(`expected rejection for ${JSON.stringify(path)}`);
  return result.reason;
}

function ok(path: string): string {
  const result = normalizeBundlePath(path);
  if (!result.ok) {
    throw new Error(
      `expected ${JSON.stringify(path)} to be accepted, got: ${result.reason}`,
    );
  }
  return result.path;
}

describe('normalizeBundlePath — happy paths', () => {
  it('accepts a simple relative path', () => {
    expect(ok('assets/photo.png')).toBe('assets/photo.png');
  });

  it('strips a leading ./', () => {
    expect(ok('./note.mk.md')).toBe('note.mk.md');
  });

  it('collapses repeated slashes', () => {
    expect(ok('.cache//data.json')).toBe('.cache/data.json');
  });

  it('collapses . segments', () => {
    expect(ok('a/./b/./c')).toBe('a/b/c');
  });

  it('normalizes away a trailing slash', () => {
    expect(ok('.cache/data.json/')).toBe('.cache/data.json');
  });

  it('treats a percent-encoded ..%2F as a literal filename segment, not traversal', () => {
    expect(ok('.cache/..%2Fetc/passwd')).toBe('.cache/..%2Fetc/passwd');
  });

  it('treats a bare "%2e%2e" as a literal filename, not decoded dots', () => {
    expect(ok('%2e%2e/secret')).toBe('%2e%2e/secret');
  });
});

describe('normalizeBundlePath — adversarial rejections', () => {
  it('rejects ".." at the start', () => {
    expect(reason('../evil')).toMatch(/\.\./);
  });

  it('rejects ".." in the middle', () => {
    expect(reason('a/../b')).toMatch(/\.\./);
  });

  it('rejects ".." at the end', () => {
    expect(reason('a/..')).toMatch(/\.\./);
  });

  it('rejects a double-up traversal buried in the path', () => {
    expect(reason('a/../../b')).toMatch(/\.\./);
  });

  it('rejects a lone ".."', () => {
    expect(reason('..')).toMatch(/\.\./);
  });

  it('rejects an absolute unix path', () => {
    expect(reason('/etc/passwd')).toMatch(/absolute/);
  });

  it('rejects a bare backslash path', () => {
    expect(reason('\\evil')).toMatch(/backslash/);
  });

  it('rejects a windows-style backslash path', () => {
    expect(reason('a\\..\\b')).toMatch(/backslash/);
  });

  it('rejects a windows drive-letter path', () => {
    expect(reason('C:\\evil.txt')).toMatch(/backslash|drive/);
  });

  it('rejects a windows drive-letter path with forward slashes', () => {
    expect(reason('C:/evil.txt')).toMatch(/drive/);
  });

  it('rejects a null byte', () => {
    expect(reason('.cache/evil\0.json')).toMatch(/null byte/);
  });

  it('rejects an empty path', () => {
    expect(reason('')).toMatch(/empty/);
  });

  it('rejects a path that is only slashes and dots', () => {
    expect(reason('././/.')).toMatch(/no meaningful segments/);
  });
});

describe('isWriteAllowed', () => {
  const noGrants = { grants: [] as const };
  const readOnly = { grants: ['read'] as const };
  const cacheWrite = { grants: ['write:.cache/'] as const };

  it('denies any write with no grants', () => {
    expect(isWriteAllowed('.cache/data.json', noGrants)).toBe(false);
  });

  it('denies cache writes with only a read grant', () => {
    expect(isWriteAllowed('.cache/data.json', readOnly)).toBe(false);
  });

  it('allows a .cache/ write with the write:.cache/ grant', () => {
    expect(isWriteAllowed('.cache/data.json', cacheWrite)).toBe(true);
  });

  it('allows a nested .cache/ write', () => {
    expect(isWriteAllowed('.cache/sub/dir/data.json', cacheWrite)).toBe(true);
  });

  it('denies a write outside .cache/ even with the grant', () => {
    expect(isWriteAllowed('assets/x.png', cacheWrite)).toBe(false);
  });

  it('denies writing ".cache" itself (no trailing segment) even with the grant', () => {
    expect(isWriteAllowed('.cache', cacheWrite)).toBe(false);
    expect(isWriteAllowed('.cache/', cacheWrite)).toBe(false);
  });

  it('denies the retired undotted "cache/" spelling even with the write:.cache/ grant', () => {
    expect(isWriteAllowed('cache/data.json', cacheWrite)).toBe(false);
  });

  it('denies writing manifest.json even with the write:.cache/ grant', () => {
    expect(isWriteAllowed('manifest.json', cacheWrite)).toBe(false);
  });

  it('denies writing note.mk.md even with the write:.cache/ grant', () => {
    expect(isWriteAllowed('note.mk.md', cacheWrite)).toBe(false);
  });

  it('denies writing manifest.json even with a (nonsensical) all-grants policy', () => {
    expect(
      isWriteAllowed('manifest.json', { grants: ['read', 'write:.cache/'] }),
    ).toBe(false);
  });

  it('denies a write for a path that fails the path-jail outright', () => {
    expect(isWriteAllowed('.cache/../manifest.json', cacheWrite)).toBe(false);
  });

  it('denies a write for a path that looks like manifest.json only after traversal is rejected upstream', () => {
    // ".cache/../../manifest.json" fails normalization before ever reaching
    // the .cache/ prefix check — still must be false, not a crash.
    expect(isWriteAllowed('.cache/../../manifest.json', cacheWrite)).toBe(
      false,
    );
  });
});
