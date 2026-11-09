import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUNDLE_DOCUMENT_PATH,
  isBundleName,
  resolveBundleDocumentPath,
} from './bundle-document.js';
import { packsNotInstalledLabel } from '../host/labels.js';

describe('isBundleName', () => {
  it('accepts the current .mkz extension', () => {
    expect(isBundleName('note.mkz')).toBe(true);
    expect(isBundleName('NOTE.MKZ')).toBe(true);
  });

  it('accepts the legacy .mkbundle extension', () => {
    expect(isBundleName('note.mkbundle')).toBe(true);
    expect(isBundleName('NOTE.MKBUNDLE')).toBe(true);
  });

  it('rejects a bare extension with nothing in front', () => {
    expect(isBundleName('.mkz')).toBe(false);
    expect(isBundleName('.mkbundle')).toBe(false);
  });

  it('rejects unrelated names', () => {
    expect(isBundleName('note.mk.md')).toBe(false);
    expect(isBundleName('note.zip')).toBe(false);
    expect(isBundleName('note.mkzz')).toBe(false);
  });
});

describe('resolveBundleDocumentPath', () => {
  it('defaults to note.mk.md when the manifest names no document', () => {
    expect(resolveBundleDocumentPath({ spec: '0.1.0' })).toBe(
      DEFAULT_BUNDLE_DOCUMENT_PATH,
    );
    expect(DEFAULT_BUNDLE_DOCUMENT_PATH).toBe('note.mk.md');
  });

  it('uses the manifest-named document when it is a valid bundle-relative path', () => {
    expect(
      resolveBundleDocumentPath({ spec: '0.1.0', document: 'main.mk.md' }),
    ).toBe('main.mk.md');
  });

  it('rejects a non-string document field', () => {
    expect(
      resolveBundleDocumentPath({ spec: '0.1.0', document: 42 as never }),
    ).toBeUndefined();
  });

  it('fails closed on a traversal attempt in the document field', () => {
    expect(
      resolveBundleDocumentPath({
        spec: '0.1.0',
        document: '../outside.mk.md',
      }),
    ).toBeUndefined();
    expect(
      resolveBundleDocumentPath({
        spec: '0.1.0',
        document: '../'.repeat(5) + 'etc/passwd',
      }),
    ).toBeUndefined();
  });

  it('rejects an absolute path in the document field', () => {
    expect(
      resolveBundleDocumentPath({ spec: '0.1.0', document: '/etc/passwd' }),
    ).toBeUndefined();
  });
});

describe('packsNotInstalledLabel', () => {
  it('names one pack in the singular and several in the plural', () => {
    expect(packsNotInstalledLabel(['ana'])).toBe('Pack not installed: ana');
    expect(packsNotInstalledLabel(['ana', 'bo'])).toBe(
      'Packs not installed: ana, bo',
    );
  });
});
