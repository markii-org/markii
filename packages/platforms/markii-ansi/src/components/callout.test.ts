import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { measureWidth } from '../text-grid.js';

describe('Callout', () => {
  it('renders the icon, type label, and body, every line barred', async () => {
    const out = await renderMarkToAnsi(
      ':::callout{type=warning title="Careful"}\nbody text\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    expect(out).toContain('▲');
    expect(out).toContain('Warning');
    expect(out).toContain('Careful');
    expect(out).toContain('body text');
    for (const line of out.trim().split('\n'))
      expect(line.startsWith('▌')).toBe(true);
  });

  it('defaults to info for a missing/invalid type', async () => {
    expect(await renderMarkToAnsi(':::callout\nx\n:::\n')).toContain('Info');
    expect(
      await renderMarkToAnsi(':::callout{type=bogus}\nx\n:::\n'),
    ).toContain('Info');
  });

  it('omits the title line when absent', async () => {
    const out = await renderMarkToAnsi(':::callout\nbody only\n:::\n');
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2); // header + body
  });

  it('narrows to about half the width under width=narrow, without corrupting the bar', async () => {
    const out = await renderMarkToAnsi(
      ':::callout{width=narrow}\nhello\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    for (const line of out.trim().split('\n')) {
      expect(line.startsWith('▌')).toBe(true);
      expect(measureWidth(line)).toBeLessThanOrEqual(20);
    }
  });
});
