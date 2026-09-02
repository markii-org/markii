import { describe, expect, it } from 'vitest';
import { ALIGN_PRESETS, LAYOUT_ATTRIBUTE_KEYS } from './layout.js';
import { STANDARD_COMPONENTS } from './contracts.js';
import {
  TEXT_ALIGN_ATTRIBUTE,
  TEXT_ALIGN_COMPONENTS,
  TEXT_ALIGN_PRESETS,
} from './text-align.js';

describe('TEXT_ALIGN_PRESETS', () => {
  it('is exactly left, center, right, in that order', () => {
    expect([...TEXT_ALIGN_PRESETS]).toEqual(['left', 'center', 'right']);
  });

  it('shares its three words with the align presets without sharing their meaning', () => {
    // The two vocabularies happen to spell the same three words, which is
    // why they are kept as separate lists: `align` moves a block's box,
    // `text` moves the text inside a component, and collapsing them into
    // one constant would invite treating them as one feature.
    expect([...TEXT_ALIGN_PRESETS]).toEqual([...ALIGN_PRESETS]);
  });
});

describe('TEXT_ALIGN_ATTRIBUTE', () => {
  it('is an optional closed enum over the three values', () => {
    expect(TEXT_ALIGN_ATTRIBUTE.type).toBe('string');
    expect(TEXT_ALIGN_ATTRIBUTE.required).toBeFalsy();
    expect(TEXT_ALIGN_ATTRIBUTE.enum).toEqual(TEXT_ALIGN_PRESETS);
  });

  it('documents the row cascade and the invalid-value fallback', () => {
    expect(TEXT_ALIGN_ATTRIBUTE.description).toContain('every cell');
    expect(TEXT_ALIGN_ATTRIBUTE.description).toContain('ignored as if absent');
  });
});

describe('TEXT_ALIGN_COMPONENTS', () => {
  it('is exactly row, cell, card, callout, table', () => {
    expect([...TEXT_ALIGN_COMPONENTS]).toEqual([
      'row',
      'cell',
      'card',
      'callout',
      'table',
    ]);
  });

  it('names only real standard components', () => {
    for (const name of TEXT_ALIGN_COMPONENTS) {
      expect(STANDARD_COMPONENTS[name], name).toBeDefined();
    }
  });

  it('is not one of the reserved layout attribute names', () => {
    // `text` reaches the component like any other attribute; a renderer
    // must never intercept it the way it intercepts `width`/`align`.
    expect([...LAYOUT_ATTRIBUTE_KEYS]).not.toContain('text');
  });
});
