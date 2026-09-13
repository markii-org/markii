import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { measureWidth } from '../text-grid.js';

describe('Divider', () => {
  it('renders a full-width rule with no label', async () => {
    const out = await renderMarkToAnsi(
      '::divider\n',
      undefined,
      undefined,
      undefined,
      { width: 20 },
    );
    expect(out.trim()).toBe('─'.repeat(20));
  });

  it('dots variant uses the dot rule character', async () => {
    const out = await renderMarkToAnsi(
      '::divider{variant=dots}\n',
      undefined,
      undefined,
      undefined,
      { width: 10 },
    );
    expect(out.trim()).toBe('·'.repeat(10));
  });

  it('weaves a label into the rule at the given width', async () => {
    const out = await renderMarkToAnsi(
      '::divider{label="Part 2"}\n',
      undefined,
      undefined,
      undefined,
      { width: 20 },
    );
    expect(measureWidth(out.trim())).toBe(20);
    expect(out).toContain('Part 2');
  });

  it('ornament variant shows the ornament glyph with no hairline', async () => {
    const out = await renderMarkToAnsi('::divider{variant=ornament}\n');
    expect(out.trim()).toBe('❖');
  });

  it('ornament with a label centers the label between two glyphs', async () => {
    const out = await renderMarkToAnsi(
      '::divider{variant=ornament label=Hi}\n',
      undefined,
      undefined,
      undefined,
      { width: 20 },
    );
    expect(out).toContain('❖ Hi ❖');
  });

  it('an invalid variant falls back to line rather than throwing', async () => {
    await expect(
      renderMarkToAnsi('::divider{variant=bogus}\n'),
    ).resolves.toBeTypeOf('string');
  });

  it('width=narrow draws ONE shorter rule rather than hard-breaking the full-width rule into two lines', async () => {
    const out = await renderMarkToAnsi(
      '::divider{width=narrow}\n',
      undefined,
      undefined,
      undefined,
      { width: 80 },
    );
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(measureWidth(lines[0] ?? '')).toBeLessThanOrEqual(40);
  });

  it('width=narrow align=right narrows then places the shorter rule at the right edge', async () => {
    const out = await renderMarkToAnsi(
      '::divider{width=narrow align=right}\n',
      undefined,
      undefined,
      undefined,
      { width: 80 },
    );
    const line = out.split('\n')[0] ?? '';
    expect(measureWidth(line)).toBe(80);
    expect(line.endsWith('─')).toBe(true);
    expect(line.startsWith(' ')).toBe(true);
  });
});
