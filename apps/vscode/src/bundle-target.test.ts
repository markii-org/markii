import { describe, expect, it } from 'vitest';
import { bundlePreviewTitleFor, classifyBundleTarget } from './bundle-target';

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
