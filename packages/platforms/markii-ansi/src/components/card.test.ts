import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { measure } from '../measure.js';

describe('Card', () => {
  it('draws a solid frame with the title woven into the top edge', () => {
    const out = renderMarkToAnsi(
      ':::card{title="Notes"}\nhello\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 30 },
    );
    expect(out).toContain('┌');
    expect(out).toContain('Notes');
    expect(out).toContain('hello');
    expect(out).toContain('└');
  });

  it('every drawn line is the same width', () => {
    const out = renderMarkToAnsi(
      ':::card{title="Notes"}\nhello world this wraps\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 20 },
    );
    const widths = new Set(
      out
        .trim()
        .split('\n')
        .map((line) => measure(line)),
    );
    expect(widths.size).toBe(1);
  });

  it('omits the title-in-edge text when title is absent', () => {
    const out = renderMarkToAnsi(
      ':::card\nbody\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 20 },
    );
    expect(out).toContain('body');
  });

  it('a width=narrow card stays a valid frame at roughly half the width', () => {
    const out = renderMarkToAnsi(
      ':::card{title=X width=narrow}\nhello\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    const lines = out.trim().split('\n');
    const width = measure(lines[0] ?? '');
    expect(width).toBeLessThanOrEqual(22);
    for (const line of lines) expect(measure(line)).toBe(width);
  });
});
