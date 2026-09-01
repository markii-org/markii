import { describe, expect, it } from 'vitest';
import { TEXT_ALIGN_PRESETS } from '@markii/stdlib';
import { createTestContext } from '../test/html-context.js';
import { Row } from './row.js';

const ctx = createTestContext();

describe('Row', () => {
  it.each(['2', '3', '4'])(
    'renders mk-row plus mk-row--cols-%s for an exact match',
    (cols) => {
      expect(Row({ cols }, 'x', ctx)).toBe(
        `<div class="mk-row mk-row--cols-${cols}">x</div>`,
      );
    },
  );

  it.each([
    ['99', 'out of range'],
    ['-1', 'negative'],
    ['abc', 'non-numeric'],
    ['2.0', 'not an exact integer string'],
    [' 2', 'leading whitespace'],
  ])('degrades to plain mk-row for an invalid cols value (%s: %s)', (cols) => {
    expect(Row({ cols }, 'x', ctx)).toBe('<div class="mk-row">x</div>');
  });

  it('degrades to plain mk-row when cols is absent', () => {
    expect(Row({}, 'x', ctx)).toBe('<div class="mk-row">x</div>');
  });

  it('degrades to plain mk-row when cols is a bare (null) attribute', () => {
    expect(Row({ cols: null }, 'x', ctx)).toBe('<div class="mk-row">x</div>');
  });
});

describe('Row — text', () => {
  it.each(TEXT_ALIGN_PRESETS)(
    'text=%s appends the matching mk-text-* class to the row itself',
    (text) => {
      expect(Row({ cols: '2', text }, 'x', ctx)).toBe(
        `<div class="mk-row mk-row--cols-2 mk-text-${text}">x</div>`,
      );
    },
  );

  it('composes with an auto-fit row', () => {
    expect(Row({ text: 'center' }, 'x', ctx)).toBe(
      '<div class="mk-row mk-text-center">x</div>',
    );
  });

  it.each([
    ['diagonal', 'unknown word'],
    ['Center', 'wrong case'],
    ['', 'empty string'],
    ['__proto__', 'a prototype member name'],
  ])('ignores an invalid text value (%s: %s)', (text) => {
    expect(Row({ text }, 'x', ctx)).toBe('<div class="mk-row">x</div>');
  });

  it('ignores a bare (null) text attribute', () => {
    expect(Row({ text: null }, 'x', ctx)).toBe('<div class="mk-row">x</div>');
  });

  it('never emits an author-supplied value into the markup', () => {
    expect(Row({ text: '"><script>alert(1)</script>' }, 'x', ctx)).toBe(
      '<div class="mk-row">x</div>',
    );
  });
});
