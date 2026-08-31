// @vitest-environment jsdom

import { act } from 'react';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  VaultImageDocument,
  applyVaultImageSources,
  createUnresolvedImageReporter,
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

/** Renders `html` into a detached container, so the sweep runs over real DOM elements. */
function container(html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
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

describe('applyVaultImageSources', () => {
  it('rewrites a figure image and a markdown image alike', () => {
    const resolver = fakeVault({
      files: ['notes/travel/a.png', 'notes/travel/b.png'],
    });
    const root = container(
      '<figure class="mk-figure"><img src="./a.png" alt=""></figure><p><img src="b.png" alt=""></p>',
    );
    applyVaultImageSources(root, NOTE, resolver);
    const sources = [...root.querySelectorAll('img')].map((image) =>
      image.getAttribute('src'),
    );
    expect(sources).toEqual([
      'app://local/vault/notes/travel/a.png?1700000000000',
      'app://local/vault/notes/travel/b.png?1700000000000',
    ]);
  });

  it('leaves remote and data sources exactly as written', () => {
    const resolver = fakeVault({});
    const root = container(
      '<img src="https://example.test/a.png"><img src="data:image/png;base64,AA">',
    );
    applyVaultImageSources(root, NOTE, resolver);
    const sources = [...root.querySelectorAll('img')].map((image) =>
      image.getAttribute('src'),
    );
    expect(sources).toEqual([
      'https://example.test/a.png',
      'data:image/png;base64,AA',
    ]);
  });

  it('keeps the original value and reports a source that matches nothing', () => {
    const resolver = fakeVault({});
    const reported: string[] = [];
    const root = container('<img src="./ghost.png">');
    applyVaultImageSources(root, NOTE, resolver, (src) => {
      reported.push(src);
    });
    expect(root.querySelector('img')?.getAttribute('src')).toBe('./ghost.png');
    expect(reported).toEqual(['./ghost.png']);
  });

  it('reports nothing for a source it deliberately left alone', () => {
    const reported: string[] = [];
    const root = container('<img src="https://example.test/a.png">');
    applyVaultImageSources(root, NOTE, fakeVault({}), (src) => {
      reported.push(src);
    });
    expect(reported).toEqual([]);
  });

  it('is idempotent: a second pass leaves the resolved URL alone', () => {
    let calls = 0;
    const resolver = fakeVault({
      files: ['notes/travel/a.png'],
      resourcePath: (vaultPath) => {
        calls += 1;
        return `app://local/vault/${vaultPath}?${String(calls)}`;
      },
    });
    const root = container('<img src="./a.png">');
    applyVaultImageSources(root, NOTE, resolver);
    applyVaultImageSources(root, NOTE, resolver);
    expect(root.querySelector('img')?.getAttribute('src')).toBe(
      'app://local/vault/notes/travel/a.png?1',
    );
    expect(calls).toBe(1);
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

describe('VaultImageDocument', () => {
  it('rewrites after the first render and again after a value update', () => {
    const resolver = fakeVault({ files: ['notes/travel/a.png'] });
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    const tree = (caption: string) =>
      createElement(
        VaultImageDocument,
        { notePath: NOTE, resolver },
        createElement('img', { src: './a.png', alt: '' }),
        createElement('span', null, caption),
      );

    act(() => {
      root.render(tree('42'));
    });
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'app://local/vault/notes/travel/a.png?1700000000000',
    );
    expect(host.querySelector('div')?.className).toBe('doc');

    // A re-render for a fresh value: React writes the author's relative
    // `src` back into the reused element, so the sweep has to run again.
    act(() => {
      root.render(tree('43'));
    });
    expect(host.querySelector('span')?.textContent).toBe('43');
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'app://local/vault/notes/travel/a.png?1700000000000',
    );

    act(() => {
      root.unmount();
    });
    host.remove();
  });
});
