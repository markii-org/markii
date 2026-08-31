import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEW_WIDTH,
  PREVIEW_WIDTHS,
  isPreviewWidth,
  normalizePreviewWidth,
  previewDocumentClassName,
  previewWidthClassName,
} from './preview-width.js';

describe('preview width', () => {
  it('offers exactly the three documented values, narrowest first', () => {
    expect([...PREVIEW_WIDTHS]).toEqual(['normal', 'wide', 'full']);
    expect(DEFAULT_PREVIEW_WIDTH).toBe('normal');
  });

  it('recognizes only those values', () => {
    expect(isPreviewWidth('wide')).toBe(true);
    expect(isPreviewWidth('WIDE')).toBe(false);
    expect(isPreviewWidth('huge')).toBe(false);
    expect(isPreviewWidth(64)).toBe(false);
    expect(isPreviewWidth(undefined)).toBe(false);
  });

  it('normalizes anything unusable to the default rather than failing', () => {
    expect(normalizePreviewWidth('full')).toBe('full');
    expect(normalizePreviewWidth('nonsense')).toBe('normal');
    expect(normalizePreviewWidth(null)).toBe('normal');
    expect(normalizePreviewWidth({ width: 'wide' })).toBe('normal');
  });

  it('leaves the default rendering classless, so today is untouched', () => {
    expect(previewWidthClassName('normal')).toBeUndefined();
    expect(previewDocumentClassName('normal')).toBe('doc');
  });

  it('names one modifier class per widened value', () => {
    expect(previewDocumentClassName('wide')).toBe('doc mk-preview--wide');
    expect(previewDocumentClassName('full')).toBe('doc mk-preview--full');
  });
});
