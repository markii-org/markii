// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { resolveDocumentUrl } from './document-images';

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

const ASSETS = {
  'assets/nice.png': 'data:image/png;base64,AAAA',
};

describe('resolveDocumentUrl — embedded bundle assets (zip form)', () => {
  it('resolves a direct match against the assets map with no baseUri at all', () => {
    expect(resolveDocumentUrl('assets/nice.png', undefined, ASSETS)).toBe(
      ASSETS['assets/nice.png'],
    );
  });

  it('normalizes a leading ./ before looking up the assets map', () => {
    expect(resolveDocumentUrl('./assets/nice.png', undefined, ASSETS)).toBe(
      ASSETS['assets/nice.png'],
    );
  });

  it('normalizes a leading / before looking up the assets map', () => {
    expect(resolveDocumentUrl('/assets/nice.png', undefined, ASSETS)).toBe(
      ASSETS['assets/nice.png'],
    );
  });

  it('prefers the assets map over baseUri when both are given', () => {
    expect(resolveDocumentUrl('assets/nice.png', BASE, ASSETS)).toBe(
      ASSETS['assets/nice.png'],
    );
  });

  it('fails closed on a traversal attempt: no baseUri, no matching key, no image', () => {
    // The assets map is built only from paths a jailed BundleStorage.list()
    // actually returned (bundle-resolve.ts), so a "../" src can never have a
    // matching entry — this asserts the failure mode is "blank image",
    // never an escape.
    expect(
      resolveDocumentUrl('../outside.png', undefined, ASSETS),
    ).toBeUndefined();
    expect(
      resolveDocumentUrl('../../etc/passwd.png', undefined, ASSETS),
    ).toBeUndefined();
  });

  it('falls back to undefined for an unmatched relative source with no baseUri', () => {
    expect(
      resolveDocumentUrl('assets/missing.png', undefined, ASSETS),
    ).toBeUndefined();
  });

  it('falls back to baseUri resolution when the assets map has no match', () => {
    expect(resolveDocumentUrl('other.png', BASE, ASSETS)).toBe(
      `${BASE}other.png`,
    );
  });
});
