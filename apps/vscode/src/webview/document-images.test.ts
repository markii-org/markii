// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { applyDocumentBase, resolveDocumentUrl } from './document-images';

const BASE = 'https://file+.vscode-resource.vscode-cdn.net/home/u/notes/';

describe('resolveDocumentUrl', () => {
  it('resolves a plain relative file name against the document folder', () => {
    expect(resolveDocumentUrl('nice.png', BASE)).toBe(`${BASE}nice.png`);
  });

  it('resolves a subfolder path', () => {
    expect(resolveDocumentUrl('img/nice.png', BASE)).toBe(
      `${BASE}img/nice.png`,
    );
  });

  it('resolves an explicit ./ prefix', () => {
    expect(resolveDocumentUrl('./nice.png', BASE)).toBe(`${BASE}nice.png`);
  });

  it('leaves https URLs untouched', () => {
    expect(resolveDocumentUrl('https://example.test/a.png', BASE)).toBe(
      undefined,
    );
  });

  it('leaves http and data URLs untouched', () => {
    expect(resolveDocumentUrl('http://example.test/a.png', BASE)).toBe(
      undefined,
    );
    expect(resolveDocumentUrl('data:image/png;base64,AAAA', BASE)).toBe(
      undefined,
    );
  });

  it('leaves a protocol-relative URL untouched', () => {
    expect(resolveDocumentUrl('//example.test/a.png', BASE)).toBe(undefined);
  });

  it('leaves a bare fragment untouched', () => {
    expect(resolveDocumentUrl('#section', BASE)).toBe(undefined);
  });

  it('leaves an empty or whitespace source untouched', () => {
    expect(resolveDocumentUrl('', BASE)).toBe(undefined);
    expect(resolveDocumentUrl('   ', BASE)).toBe(undefined);
  });

  it('resolves nothing at all without a base URI (an unsaved document)', () => {
    expect(resolveDocumentUrl('nice.png', undefined)).toBe(undefined);
  });

  it('treats a colon AFTER a path separator as part of a relative path', () => {
    // Same scheme-detection rule as `@markii/core`'s isSafeUrl.
    expect(resolveDocumentUrl('img/a:b.png', BASE)).toBe(`${BASE}img/a:b.png`);
  });

  it('resolves a traversal attempt to a URL outside the folder rather than hiding it', () => {
    // Resolution is not authorization: this produces a perfectly ordinary
    // URL that VS Code then refuses to serve, because it lies outside the
    // panel's localResourceRoots. Nothing here must "sanitize" it into
    // something that looks loadable.
    expect(resolveDocumentUrl('../../etc/passwd', BASE)).toBe(
      'https://file+.vscode-resource.vscode-cdn.net/home/etc/passwd',
    );
    // And `..` can never climb past the host root, however many are stacked.
    expect(resolveDocumentUrl('../'.repeat(20) + 'etc/passwd', BASE)).toBe(
      'https://file+.vscode-resource.vscode-cdn.net/etc/passwd',
    );
  });

  it('degrades to no rewrite for an unparseable base URI', () => {
    expect(resolveDocumentUrl('nice.png', 'not a url')).toBe(undefined);
  });
});

/** Builds a detached container holding `html`, the way the rendered document subtree looks to the effect. */
function container(html: string): HTMLElement {
  const element = document.createElement('div');
  element.innerHTML = html;
  return element;
}

describe('applyDocumentBase', () => {
  it('rewrites a relative image source', () => {
    const element = container('<img src="nice.png" alt="">');
    applyDocumentBase(element, BASE);
    expect(element.querySelector('img')?.getAttribute('src')).toBe(
      `${BASE}nice.png`,
    );
  });

  it('leaves a remote image source alone', () => {
    const element = container('<img src="https://example.test/a.png" alt="">');
    applyDocumentBase(element, BASE);
    expect(element.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.test/a.png',
    );
  });

  it('rewrites every image, mixed sources included', () => {
    const element = container(
      '<figure><img src="a.png" alt=""></figure>' +
        '<img src="https://example.test/b.png" alt="">' +
        '<p><img src="sub/c.png" alt=""></p>',
    );
    applyDocumentBase(element, BASE);
    const sources = [...element.querySelectorAll('img')].map((img) =>
      img.getAttribute('src'),
    );
    expect(sources).toEqual([
      `${BASE}a.png`,
      'https://example.test/b.png',
      `${BASE}sub/c.png`,
    ]);
  });

  it('is idempotent', () => {
    const element = container('<img src="nice.png" alt="">');
    applyDocumentBase(element, BASE);
    applyDocumentBase(element, BASE);
    expect(element.querySelector('img')?.getAttribute('src')).toBe(
      `${BASE}nice.png`,
    );
  });

  it('leaves everything alone without a base URI', () => {
    const element = container('<img src="nice.png" alt="">');
    applyDocumentBase(element, undefined);
    expect(element.querySelector('img')?.getAttribute('src')).toBe('nice.png');
  });

  it('skips an image with no src attribute at all', () => {
    const element = container('<img alt="">');
    expect(() => applyDocumentBase(element, BASE)).not.toThrow();
    expect(element.querySelector('img')?.hasAttribute('src')).toBe(false);
  });

  it('does not touch anchors — fragment links keep working', () => {
    const element = container('<a href="#section">jump</a>');
    applyDocumentBase(element, BASE);
    expect(element.querySelector('a')?.getAttribute('href')).toBe('#section');
  });

  it('does not touch script or link elements', () => {
    const element = container(
      '<script src="main.js"></script><link rel="stylesheet" href="main.css">',
    );
    applyDocumentBase(element, BASE);
    expect(element.querySelector('script')?.getAttribute('src')).toBe(
      'main.js',
    );
    expect(element.querySelector('link')?.getAttribute('href')).toBe(
      'main.css',
    );
  });
});
