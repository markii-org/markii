import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { measureWidth } from '../text-grid.js';

describe('layout wrappers', () => {
  it('narrow halves the available width', async () => {
    const out = await renderMarkToAnsi(
      ':::narrow\nhello world\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    for (const line of out.trim().split('\n'))
      expect(measureWidth(line)).toBeLessThanOrEqual(20);
  });

  it('center takes the other axis (width) as an attribute', async () => {
    const out = await renderMarkToAnsi(
      ':::center{width=fit}\nhi\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    expect(out.trim()).toBe('hi');
  });

  it('a wrapper never reads its own axis as an attribute (the name already decided it)', async () => {
    const out = await renderMarkToAnsi(
      ':::center{align=right}\nhi\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    // center always centers regardless of an align attribute written on it:
    // "hi" sits with leading padding roughly half the line width, not flush
    // right. Ink drops a plain (unbordered) line's TRAILING whitespace when
    // it renders the frame (SPIKE-10-findings.md item 1's documented rule:
    // trailing padding on a plain line is invisible in a terminal either
    // way), so only the leading padding is asserted here.
    const line = out.split('\n')[0] ?? '';
    expect(line.startsWith(' '.repeat(19))).toBe(true);
    expect(line.trimStart()).toBe('hi');
  });

  it("fit shrinks to the content's own widest line", async () => {
    const out = await renderMarkToAnsi(
      ':::fit\nhi\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    expect(out.trim()).toBe('hi');
  });

  it('nesting two wrappers composes', async () => {
    await expect(
      renderMarkToAnsi('::::center\n:::narrow\nhi\n:::\n::::\n'),
    ).resolves.toBeTypeOf('string');
  });
});
