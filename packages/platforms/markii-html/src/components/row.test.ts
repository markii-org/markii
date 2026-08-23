import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../escape.js';
import { Row } from './row.js';

const ctx = { esc: escapeHtml };

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
