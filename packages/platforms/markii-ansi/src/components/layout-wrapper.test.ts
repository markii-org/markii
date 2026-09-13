import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { measure } from '../measure.js';

describe('layout wrappers', () => {
  it('narrow halves the available width', () => {
    const out = renderMarkToAnsi(
      ':::narrow\nhello world\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    for (const line of out.trim().split('\n'))
      expect(measure(line)).toBeLessThanOrEqual(20);
  });

  it('center takes the other axis (width) as an attribute', () => {
    const out = renderMarkToAnsi(
      ':::center{width=fit}\nhi\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    expect(out.trim()).toBe('hi');
  });

  it('a wrapper never reads its own axis as an attribute (the name already decided it)', () => {
    const out = renderMarkToAnsi(
      ':::center{align=right}\nhi\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    // center always centers regardless of an align attribute written on it,
    // so "hi" sits with roughly equal padding on both sides, not flush right.
    const line = out.split('\n')[0] ?? '';
    expect(measure(line)).toBe(40);
    expect(line.startsWith(' '.repeat(19))).toBe(true);
  });

  it("fit shrinks to the content's own widest line", () => {
    const out = renderMarkToAnsi(
      ':::fit\nhi\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    expect(out.trim()).toBe('hi');
  });

  it('nesting two wrappers composes', () => {
    expect(() =>
      renderMarkToAnsi('::::center\n:::narrow\nhi\n:::\n::::\n'),
    ).not.toThrow();
  });
});
