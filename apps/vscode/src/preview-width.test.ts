import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREVIEW_WIDTH,
  HIDE_SCRIPT_BLOCKS_CLASS,
  PREVIEW_WIDTHS,
  isPreviewWidth,
  normalizeHideScriptBlocks,
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

describe('hidden script blocks (markii.hideScriptBlocks, issue #34)', () => {
  it('reads only a real true as on, so a missing or hostile value renders as it always has', () => {
    expect(normalizeHideScriptBlocks(true)).toBe(true);
    expect(normalizeHideScriptBlocks(false)).toBe(false);
    expect(normalizeHideScriptBlocks(undefined)).toBe(false);
    expect(normalizeHideScriptBlocks('true')).toBe(false);
    expect(normalizeHideScriptBlocks(1)).toBe(false);
    expect(normalizeHideScriptBlocks({})).toBe(false);
  });

  it('defaults to off, so omitting the argument is the rendering the preview has always had', () => {
    expect(previewDocumentClassName('normal')).toBe('doc');
    expect(previewDocumentClassName('normal', false)).toBe('doc');
  });

  it('adds one modifier class, alongside the width class when there is one', () => {
    expect(previewDocumentClassName('normal', true)).toBe(
      `doc ${HIDE_SCRIPT_BLOCKS_CLASS}`,
    );
    expect(previewDocumentClassName('wide', true)).toBe(
      `doc mk-preview--wide ${HIDE_SCRIPT_BLOCKS_CLASS}`,
    );
    expect(previewDocumentClassName('full', true)).toBe(
      `doc mk-preview--full ${HIDE_SCRIPT_BLOCKS_CLASS}`,
    );
  });
});
