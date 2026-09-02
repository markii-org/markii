import { describe, expect, it } from 'vitest';
import {
  createUnresolvedImageReporter,
  createVaultImageResolver,
  resolveVaultImageResource,
} from './preview-images.js';
import type { VaultImageResolver } from './preview-images.js';

const NOTE = 'notes/travel/trip.mk.md';

/** A tiny in-memory vault: the set of real file paths, plus what the link index answers. `getResourcePath` gets the shape Obsidian actually returns. */
function fakeVault(options: {
  files?: string[];
  linkTargets?: Record<string, string>;
  resourcePath?: (vaultPath: string) => string;
}): VaultImageResolver {
  const files = new Set(options.files ?? []);
  const linkTargets = options.linkTargets ?? {};
  return {
    linkpathDest: (src) => linkTargets[src],
    vaultPathExists: (vaultPath) => files.has(vaultPath),
    resourcePath:
      options.resourcePath ??
      ((vaultPath) => `app://local/vault/${vaultPath}?1700000000000`),
  };
}

describe('resolveVaultImageResource', () => {
  it('resolves a file sitting next to the note, written with ./', () => {
    const resolver = fakeVault({ files: ['notes/travel/test_image.png'] });
    expect(resolveVaultImageResource('./test_image.png', NOTE, resolver)).toBe(
      'app://local/vault/notes/travel/test_image.png?1700000000000',
    );
  });

  it('resolves a bare sibling file name', () => {
    const resolver = fakeVault({ files: ['notes/travel/test_image.png'] });
    expect(resolveVaultImageResource('test_image.png', NOTE, resolver)).toBe(
      'app://local/vault/notes/travel/test_image.png?1700000000000',
    );
  });

  it('resolves a vault-relative path from the vault root', () => {
    const resolver = fakeVault({ files: ['assets/logo.png'] });
    expect(resolveVaultImageResource('assets/logo.png', NOTE, resolver)).toBe(
      'app://local/vault/assets/logo.png?1700000000000',
    );
    expect(resolveVaultImageResource('/assets/logo.png', NOTE, resolver)).toBe(
      'app://local/vault/assets/logo.png?1700000000000',
    );
  });

  it('falls back to the link index, so a shortest-path reference behaves as it does elsewhere', () => {
    const resolver = fakeVault({
      linkTargets: { 'logo.png': 'attachments/logo.png' },
    });
    expect(resolveVaultImageResource('logo.png', NOTE, resolver)).toBe(
      'app://local/vault/attachments/logo.png?1700000000000',
    );
  });

  it('prefers the file next to the note over the link index', () => {
    const resolver = fakeVault({
      files: ['notes/travel/logo.png'],
      linkTargets: { 'logo.png': 'attachments/logo.png' },
    });
    expect(resolveVaultImageResource('logo.png', NOTE, resolver)).toBe(
      'app://local/vault/notes/travel/logo.png?1700000000000',
    );
  });

  it('resolves a percent-encoded source', () => {
    const resolver = fakeVault({ files: ['notes/travel/my image.png'] });
    expect(resolveVaultImageResource('my%20image.png', NOTE, resolver)).toBe(
      'app://local/vault/notes/travel/my image.png?1700000000000',
    );
  });

  it('resolves nothing when no file matches', () => {
    const resolver = fakeVault({});
    expect(
      resolveVaultImageResource('ghost.png', NOTE, resolver),
    ).toBeUndefined();
  });

  it('never asks the vault for a source that carries a scheme', () => {
    const resolver: VaultImageResolver = {
      linkpathDest: () => {
        throw new Error('should never be asked');
      },
      vaultPathExists: () => {
        throw new Error('should never be asked');
      },
      resourcePath: () => {
        throw new Error('should never be asked');
      },
    };
    expect(
      resolveVaultImageResource('https://example.test/a.png', NOTE, resolver),
    ).toBeUndefined();
    expect(
      resolveVaultImageResource('data:image/png;base64,AA', NOTE, resolver),
    ).toBeUndefined();
  });

  it('never hands an absolute path to getResourcePath', () => {
    const asked: string[] = [];
    const resolver: VaultImageResolver = {
      // A link resolver that answered with an absolute path would still
      // never reach the adapter.
      linkpathDest: () => '/etc/passwd',
      vaultPathExists: () => false,
      resourcePath: (vaultPath) => {
        asked.push(vaultPath);
        return vaultPath;
      },
    };
    expect(
      resolveVaultImageResource('../../../etc/passwd', NOTE, resolver),
    ).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it('survives a vault call that throws', () => {
    const resolver: VaultImageResolver = {
      linkpathDest: () => {
        throw new Error('index exploded');
      },
      vaultPathExists: () => {
        throw new Error('vault exploded');
      },
      resourcePath: () => 'unreachable',
    };
    expect(resolveVaultImageResource('a.png', NOTE, resolver)).toBeUndefined();
  });
});

describe('createUnresolvedImageReporter', () => {
  it('writes one line naming the source and the note, once per pair', () => {
    const lines: string[] = [];
    const report = createUnresolvedImageReporter((line) => {
      lines.push(line);
    });
    report('./ghost.png', NOTE);
    report('./ghost.png', NOTE);
    report('./ghost.png', 'other.mk.md');
    expect(lines).toEqual([
      `[markii] no file in the vault matches the image source ./ghost.png in ${NOTE}`,
      '[markii] no file in the vault matches the image source ./ghost.png in other.mk.md',
    ]);
  });
});

describe('createVaultImageResolver', () => {
  it('resolves a figure image and a markdown image alike, the same way resolveVaultImageResource does', () => {
    const resolver = fakeVault({
      files: ['notes/travel/a.png', 'notes/travel/b.png'],
    });
    const resolveImageSrc = createVaultImageResolver(NOTE, resolver);
    expect(resolveImageSrc('./a.png')).toBe(
      'app://local/vault/notes/travel/a.png?1700000000000',
    );
    expect(resolveImageSrc('b.png')).toBe(
      'app://local/vault/notes/travel/b.png?1700000000000',
    );
  });

  it('keeps the original value and reports a source that matches nothing', () => {
    const reported: string[] = [];
    const resolveImageSrc = createVaultImageResolver(
      NOTE,
      fakeVault({}),
      (src) => {
        reported.push(src);
      },
    );
    expect(resolveImageSrc('./ghost.png')).toBeUndefined();
    expect(reported).toEqual(['./ghost.png']);
  });

  it('reports nothing for a source vaultImageCandidates has no reading of at all', () => {
    // `renderMark` never offers a scheme-carrying source to the resolver in
    // the first place, but this asserts the resolver's own defense too.
    const reported: string[] = [];
    const resolveImageSrc = createVaultImageResolver(
      NOTE,
      fakeVault({}),
      (src) => {
        reported.push(src);
      },
    );
    expect(resolveImageSrc('https://example.test/a.png')).toBeUndefined();
    expect(reported).toEqual([]);
  });

  it('is idempotent-friendly: asking twice for the same source calls the vault twice but resolves the same way', () => {
    let calls = 0;
    const resolver = fakeVault({
      files: ['notes/travel/a.png'],
      resourcePath: (vaultPath) => {
        calls += 1;
        return `app://local/vault/${vaultPath}?${String(calls)}`;
      },
    });
    const resolveImageSrc = createVaultImageResolver(NOTE, resolver);
    expect(resolveImageSrc('./a.png')).toBe(
      'app://local/vault/notes/travel/a.png?1',
    );
    expect(resolveImageSrc('./a.png')).toBe(
      'app://local/vault/notes/travel/a.png?2',
    );
  });
});
