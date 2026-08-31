import { describe, expect, it } from 'vitest';
import { LAYOUT_ATTRIBUTE_KEYS, resolveLayoutAttributes } from './layout.js';

describe('LAYOUT_ATTRIBUTE_KEYS', () => {
  it('is exactly width and align', () => {
    expect([...LAYOUT_ATTRIBUTE_KEYS].sort()).toEqual(['align', 'width']);
  });
});

describe('resolveLayoutAttributes — width', () => {
  it.each([
    ['fit', 'mk-width-fit'],
    ['narrow', 'mk-width-narrow'],
    ['wide', 'mk-width-wide'],
    ['full', 'mk-width-full'],
  ])('maps width=%s to class %s', (value, expectedClass) => {
    const result = resolveLayoutAttributes({ width: value });
    expect(result.className).toBe(expectedClass);
    expect(result.attributes).toEqual({});
  });

  it('produces no class for width=normal (the explicit default)', () => {
    const result = resolveLayoutAttributes({ width: 'normal' });
    expect(result.className).toBeUndefined();
    expect(result.attributes).toEqual({});
  });

  it.each([
    ['WIDE', 'wrong case'],
    ['', 'empty string'],
    ['javascript:alert(1)', 'a URI scheme'],
    ['"; }', 'quote/brace injection attempt'],
    ['<script>alert(1)</script>', 'a script tag'],
    ['wide;color:red', 'CSS-injection-shaped value'],
    ['wide"', 'a value containing a quote'],
  ])(
    'produces no class for an invalid/hostile width value (%s: %s)',
    (value) => {
      const result = resolveLayoutAttributes({ width: value });
      expect(result.className).toBeUndefined();
    },
  );

  it('produces no class for a bare (valueless -> null) width attribute', () => {
    const result = resolveLayoutAttributes({ width: null });
    expect(result.className).toBeUndefined();
    expect(result.attributes).toEqual({});
  });

  it('strips width from attributes whenever present, valid or not', () => {
    expect(
      resolveLayoutAttributes({ width: 'wide', title: 'x' }).attributes,
    ).toEqual({ title: 'x' });
    expect(
      resolveLayoutAttributes({ width: 'bogus', title: 'x' }).attributes,
    ).toEqual({ title: 'x' });
  });

  it('leaves attributes untouched when width is absent', () => {
    const result = resolveLayoutAttributes({ title: 'x' });
    expect(result.attributes).toEqual({ title: 'x' });
    expect(result.className).toBeUndefined();
  });
});

describe('resolveLayoutAttributes — align', () => {
  it.each([
    ['left', 'mk-align-left'],
    ['center', 'mk-align-center'],
    ['right', 'mk-align-right'],
  ])('maps align=%s to class %s', (value, expectedClass) => {
    const result = resolveLayoutAttributes({ align: value });
    expect(result.className).toBe(expectedClass);
    expect(result.attributes).toEqual({});
  });

  it.each([
    ['CENTER', 'wrong case'],
    ['', 'empty string'],
    ['javascript:alert(1)', 'a URI scheme'],
    ['middle', 'not one of the three allowed values'],
  ])(
    'produces no class for an invalid/hostile align value (%s: %s)',
    (value) => {
      const result = resolveLayoutAttributes({ align: value });
      expect(result.className).toBeUndefined();
    },
  );

  it('produces no class for a bare (valueless -> null) align attribute', () => {
    const result = resolveLayoutAttributes({ align: null });
    expect(result.className).toBeUndefined();
    expect(result.attributes).toEqual({});
  });

  it('strips align from attributes whenever present, valid or not', () => {
    expect(
      resolveLayoutAttributes({ align: 'center', title: 'x' }).attributes,
    ).toEqual({ title: 'x' });
    expect(
      resolveLayoutAttributes({ align: 'bogus', title: 'x' }).attributes,
    ).toEqual({ title: 'x' });
  });
});

describe('resolveLayoutAttributes — combined / prototype safety / never throws', () => {
  it('combines width and align into one space-joined class string', () => {
    const result = resolveLayoutAttributes({
      width: 'wide',
      align: 'center',
    });
    expect(result.className).toBe('mk-width-wide mk-align-center');
    expect(result.attributes).toEqual({});
  });

  it('returns attributes unchanged and className undefined when neither key is present', () => {
    const input = { title: 'x', label: 'y' };
    const result = resolveLayoutAttributes(input);
    expect(result.attributes).toEqual(input);
    expect(result.className).toBeUndefined();
  });

  it('never resolves a value/key named __proto__ or constructor to a class via the prototype chain', () => {
    expect(() => resolveLayoutAttributes({ width: '__proto__' })).not.toThrow();
    expect(
      resolveLayoutAttributes({ width: '__proto__' }).className,
    ).toBeUndefined();
    expect(() =>
      resolveLayoutAttributes({ align: 'constructor' }),
    ).not.toThrow();
    expect(
      resolveLayoutAttributes({ align: 'constructor' }).className,
    ).toBeUndefined();
  });

  it('never throws for an empty attributes object', () => {
    expect(() => resolveLayoutAttributes({})).not.toThrow();
    expect(resolveLayoutAttributes({})).toEqual({ attributes: {} });
  });
});

describe('resolveLayoutAttributes — width=fit with an alignment', () => {
  // The pairing the preset exists for: `fit` shrinks the box to its content,
  // which is what finally gives `mk-align-*`'s auto margins room to place it.
  it.each([
    ['left', 'mk-width-fit mk-align-left'],
    ['center', 'mk-width-fit mk-align-center'],
    ['right', 'mk-width-fit mk-align-right'],
  ])('combines width=fit with align=%s as "%s"', (align, expectedClass) => {
    const result = resolveLayoutAttributes({ width: 'fit', align });
    expect(result.className).toBe(expectedClass);
    expect(result.attributes).toEqual({});
  });

  it('keeps a hostile align from reaching the class list even alongside width=fit', () => {
    const result = resolveLayoutAttributes({
      width: 'fit',
      align: 'right;color:red',
    });
    expect(result.className).toBe('mk-width-fit');
  });
});
