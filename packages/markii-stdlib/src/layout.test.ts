import { describe, expect, it } from 'vitest';
import {
  ALIGN_PRESETS,
  LAYOUT_ATTRIBUTE_KEYS,
  LAYOUT_ATTRIBUTES,
  WIDTH_PRESETS,
} from './layout.js';

describe('LAYOUT_ATTRIBUTE_KEYS', () => {
  it('is exactly width and align', () => {
    expect([...LAYOUT_ATTRIBUTE_KEYS].sort()).toEqual(['align', 'width']);
  });
});

describe('WIDTH_PRESETS', () => {
  it('reads narrowest to widest: fit, narrow, normal, wide, full', () => {
    expect(WIDTH_PRESETS).toEqual(['fit', 'narrow', 'normal', 'wide', 'full']);
  });

  it('keeps normal as the one preset that maps to no class', () => {
    // Both renderers derive their class map by filtering `normal` out of
    // this list, so a rename or a second classless preset would silently
    // change what `mk-width-*` classes exist.
    expect(WIDTH_PRESETS).toContain('normal');
  });
});

describe('ALIGN_PRESETS', () => {
  it('is left, center, right', () => {
    expect(ALIGN_PRESETS).toEqual(['left', 'center', 'right']);
  });
});

describe('LAYOUT_ATTRIBUTES', () => {
  it('width carries the width presets as its enum and is optional', () => {
    expect(LAYOUT_ATTRIBUTES.width.enum).toEqual(WIDTH_PRESETS);
    expect(LAYOUT_ATTRIBUTES.width.required).toBe(false);
    expect(LAYOUT_ATTRIBUTES.width.type).toBe('string');
    expect(LAYOUT_ATTRIBUTES.width.description.length).toBeGreaterThan(0);
  });

  it('align carries the align presets as its enum and is optional', () => {
    expect(LAYOUT_ATTRIBUTES.align.enum).toEqual(ALIGN_PRESETS);
    expect(LAYOUT_ATTRIBUTES.align.required).toBe(false);
    expect(LAYOUT_ATTRIBUTES.align.type).toBe('string');
    expect(LAYOUT_ATTRIBUTES.align.description.length).toBeGreaterThan(0);
  });

  it('has exactly the two reserved keys', () => {
    expect(Object.keys(LAYOUT_ATTRIBUTES).sort()).toEqual(['align', 'width']);
  });
});
