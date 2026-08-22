import { describe, expect, it } from 'vitest';
import {
  bundlePreviewTitleFor,
  classifyBundleTarget,
  isBundleName,
} from './bundle-target';

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

describe('classifyBundleTarget', () => {
  it('classifies a bundle-named directory as "directory"', () => {
    expect(classifyBundleTarget('note.mkz', true)).toBe('directory');
    expect(classifyBundleTarget('note.mkbundle', true)).toBe('directory');
  });

  it('classifies a bundle-named file as "zip"', () => {
    expect(classifyBundleTarget('note.mkz', false)).toBe('zip');
    expect(classifyBundleTarget('note.mkbundle', false)).toBe('zip');
  });

  it('classifies anything else as "not-a-bundle", regardless of shape', () => {
    expect(classifyBundleTarget('note.mk.md', false)).toBe('not-a-bundle');
    expect(classifyBundleTarget('notes', true)).toBe('not-a-bundle');
  });
});

describe('bundlePreviewTitleFor', () => {
  it('names the tab after the bundle', () => {
    expect(bundlePreviewTitleFor('note.mkz', false)).toBe('Preview note.mkz');
  });

  it('marks a read-only (zip-form) preview quietly in the title', () => {
    expect(bundlePreviewTitleFor('note.mkz', true)).toBe(
      'Preview note.mkz (read-only)',
    );
  });
});
