import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';

describe('Cell', () => {
  it('renders standalone content unchanged', () => {
    const out = renderMarkToAnsi(':::cell\nhello\n:::\n');
    expect(out.trim()).toBe('hello');
  });

  it('collapses the blank line between its own two sub-blocks into one line break', () => {
    const out = renderMarkToAnsi(':::cell\nfirst\n\nsecond\n:::\n');
    expect(out.trim().split('\n\n').length).toBe(1);
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  it('an invalid text value is ignored rather than throwing', () => {
    expect(() =>
      renderMarkToAnsi(':::cell{text=bogus}\nx\n:::\n'),
    ).not.toThrow();
  });
});
