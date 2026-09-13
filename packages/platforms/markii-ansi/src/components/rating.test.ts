import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';

describe('Rating', () => {
  it('renders filled and empty stars', async () => {
    const out = await renderMarkToAnsi('::rating{value=3 max=5}\n');
    expect(out.trim()).toBe('★★★☆☆');
  });

  it('defaults to 0 of 5 when both attributes are absent', async () => {
    const out = await renderMarkToAnsi('::rating\n');
    expect(out.trim()).toBe('☆☆☆☆☆');
  });

  it('clamps value to max and max to [1, 20]', async () => {
    expect((await renderMarkToAnsi('::rating{value=99 max=3}\n')).trim()).toBe(
      '★★★',
    );
    expect((await renderMarkToAnsi('::rating{max=999}\n')).trim()).toHaveLength(
      20,
    );
  });

  it('non-numeric input falls back to defaults rather than throwing', async () => {
    await expect(
      renderMarkToAnsi('::rating{value=abc max=xyz}\n'),
    ).resolves.toBeTypeOf('string');
  });
});
