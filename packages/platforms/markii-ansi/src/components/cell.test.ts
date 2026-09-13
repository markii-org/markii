import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';

describe('Cell', () => {
  it('renders standalone content unchanged', async () => {
    const out = await renderMarkToAnsi(':::cell\nhello\n:::\n');
    expect(out.trim()).toBe('hello');
  });

  it('keeps the blank line between its own two sub-blocks as two separate paragraphs', async () => {
    const out = await renderMarkToAnsi(':::cell\nfirst\n\nsecond\n:::\n');
    expect(out.trim().split('\n\n').length).toBe(2);
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  it('an invalid text value is ignored rather than throwing', async () => {
    await expect(
      renderMarkToAnsi(':::cell{text=bogus}\nx\n:::\n'),
    ).resolves.toBeTypeOf('string');
  });
});
