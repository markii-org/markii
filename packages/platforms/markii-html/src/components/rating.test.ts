import { describe, expect, it } from 'vitest';
import { createTestContext } from '../test/html-context.js';
import { Rating } from './rating.js';

const ctx = createTestContext();

describe('Rating', () => {
  it('defaults to 0 out of 5 when no attributes are given', () => {
    const html = Rating({}, '', ctx);
    expect(html).toContain('aria-label="rating: 0 out of 5"');
    expect((html.match(/mk-rating__star--filled/g) ?? []).length).toBe(0);
    expect((html.match(/mk-rating__star/g) ?? []).length).toBe(5);
  });

  it('fills the requested number of stars', () => {
    const html = Rating({ value: '3', max: '5' }, '', ctx);
    expect(html).toContain('aria-label="rating: 3 out of 5"');
    expect((html.match(/mk-rating__star--filled/g) ?? []).length).toBe(3);
  });

  it('clamps value to max and max to [1, 20]', () => {
    expect(Rating({ value: '99', max: '5' }, '', ctx)).toContain(
      'aria-label="rating: 5 out of 5"',
    );
    expect(Rating({ max: '999' }, '', ctx)).toContain('out of 20');
    expect(Rating({ max: '0' }, '', ctx)).toContain('out of 1');
  });

  it('falls back gracefully for non-numeric input rather than throwing', () => {
    expect(() => Rating({ value: 'abc', max: 'xyz' }, '', ctx)).not.toThrow();
    expect(Rating({ value: 'abc', max: 'xyz' }, '', ctx)).toContain(
      'aria-label="rating: 0 out of 5"',
    );
  });
});
