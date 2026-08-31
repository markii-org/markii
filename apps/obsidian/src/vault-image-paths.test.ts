import { describe, expect, it } from 'vitest';
import {
  isResolvableImageSource,
  isVaultRelativePath,
  noteFolderPath,
  normalizeVaultPath,
  vaultImageCandidates,
} from './vault-image-paths.js';

const NOTE = 'notes/travel/trip.mk.md';

/** The candidate list flattened to `kind:value` strings, which reads far better in an assertion than the object form. */
function candidates(src: string, notePath = NOTE): string[] {
  return vaultImageCandidates(src, notePath).map(
    (candidate) => `${candidate.kind}:${candidate.value}`,
  );
}

describe('isResolvableImageSource', () => {
  it('accepts the shapes a writer means as a vault file', () => {
    expect(isResolvableImageSource('test_image.png')).toBe(true);
    expect(isResolvableImageSource('./test_image.png')).toBe(true);
    expect(isResolvableImageSource('../shared/logo.png')).toBe(true);
    expect(isResolvableImageSource('/assets/logo.png')).toBe(true);
    expect(isResolvableImageSource('img/a:b.png')).toBe(true);
  });

  it('leaves anything that already resolves on its own alone', () => {
    expect(isResolvableImageSource('')).toBe(false);
    expect(isResolvableImageSource('   ')).toBe(false);
    expect(isResolvableImageSource('#section')).toBe(false);
    expect(isResolvableImageSource('//example.test/a.png')).toBe(false);
    expect(isResolvableImageSource('https://example.test/a.png')).toBe(false);
    expect(isResolvableImageSource('data:image/png;base64,AAAA')).toBe(false);
    expect(isResolvableImageSource('app://local/x.png')).toBe(false);
  });

  it('leaves an absolute Windows or UNC path alone', () => {
    expect(isResolvableImageSource('C:\\pictures\\a.png')).toBe(false);
    expect(isResolvableImageSource('\\\\server\\share\\a.png')).toBe(false);
  });
});

describe('isVaultRelativePath', () => {
  it('accepts a plain vault path and refuses anything absolute', () => {
    expect(isVaultRelativePath('notes/a.png')).toBe(true);
    expect(isVaultRelativePath('')).toBe(false);
    expect(isVaultRelativePath('/etc/passwd')).toBe(false);
    expect(isVaultRelativePath('\\\\server\\share')).toBe(false);
    expect(isVaultRelativePath('file:///etc/passwd')).toBe(false);
  });
});

describe('noteFolderPath', () => {
  it('is the folder part, and empty for a note at the vault root', () => {
    expect(noteFolderPath('notes/travel/trip.mk.md')).toBe('notes/travel');
    expect(noteFolderPath('trip.mk.md')).toBe('');
  });
});

describe('normalizeVaultPath', () => {
  it('drops noise segments and applies ..', () => {
    expect(normalizeVaultPath('notes/./a.png')).toBe('notes/a.png');
    expect(normalizeVaultPath('/assets//a.png')).toBe('assets/a.png');
    expect(normalizeVaultPath('notes/travel/../a.png')).toBe('notes/a.png');
  });

  it('refuses a path that climbs above the vault root', () => {
    expect(normalizeVaultPath('../../etc/passwd')).toBeUndefined();
    expect(normalizeVaultPath('notes/../../etc/passwd')).toBeUndefined();
  });

  it('refuses a path that reduces to nothing', () => {
    expect(normalizeVaultPath('./')).toBeUndefined();
  });
});

describe('vaultImageCandidates', () => {
  it('tries the note folder first, then the link index, then the vault root', () => {
    expect(candidates('test_image.png')).toEqual([
      'path:notes/travel/test_image.png',
      'linkpath:test_image.png',
      'path:test_image.png',
    ]);
  });

  it('reads an explicit ./ prefix as note-relative', () => {
    expect(candidates('./test_image.png')).toEqual([
      'path:notes/travel/test_image.png',
      'linkpath:./test_image.png',
      'path:test_image.png',
    ]);
  });

  it('walks .. up from the note folder', () => {
    expect(candidates('../shared/logo.png')).toEqual([
      'path:notes/shared/logo.png',
      'linkpath:../shared/logo.png',
    ]);
  });

  it('reads a leading slash as vault-root only, never note-relative', () => {
    expect(candidates('/assets/logo.png')).toEqual([
      'linkpath:/assets/logo.png',
      'path:assets/logo.png',
    ]);
  });

  it('produces no path candidate outside the vault for a traversal attempt', () => {
    expect(candidates('../../../../etc/passwd')).toEqual([
      'linkpath:../../../../etc/passwd',
    ]);
  });

  it('collapses the note-relative and vault-relative forms for a note at the root', () => {
    expect(candidates('a.png', 'trip.mk.md')).toEqual([
      'path:a.png',
      'linkpath:a.png',
    ]);
  });

  it('also looks for the percent-decoded form of a source', () => {
    expect(candidates('my%20image.png')).toEqual([
      'path:notes/travel/my%20image.png',
      'path:notes/travel/my image.png',
      'linkpath:my%20image.png',
      'linkpath:my image.png',
      'path:my%20image.png',
      'path:my image.png',
    ]);
  });

  it('keeps the raw form when it cannot be decoded', () => {
    expect(candidates('50%_done.png')).toEqual([
      'path:notes/travel/50%_done.png',
      'linkpath:50%_done.png',
      'path:50%_done.png',
    ]);
  });

  it('is empty for a source that must be left as written', () => {
    expect(candidates('https://example.test/a.png')).toEqual([]);
    expect(candidates('data:image/png;base64,AAAA')).toEqual([]);
    expect(candidates('#section')).toEqual([]);
    expect(candidates('')).toEqual([]);
  });
});
