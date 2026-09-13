import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { measure } from '../measure.js';

describe('Callout', () => {
  it('renders the icon, type label, and body, every line barred', () => {
    const out = renderMarkToAnsi(
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

  it('defaults to info for a missing/invalid type', () => {
    expect(renderMarkToAnsi(':::callout\nx\n:::\n')).toContain('Info');
    expect(renderMarkToAnsi(':::callout{type=bogus}\nx\n:::\n')).toContain(
      'Info',
    );
  });

  it('omits the title line when absent', () => {
    const out = renderMarkToAnsi(':::callout\nbody only\n:::\n');
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2); // header + body
  });

  it('narrows to about half the width under width=narrow, without corrupting the bar', () => {
    const out = renderMarkToAnsi(
      ':::callout{width=narrow}\nhello\n:::\n',
      undefined,
      undefined,
      undefined,
      { width: 40 },
    );
    for (const line of out.trim().split('\n')) {
      expect(line.startsWith('▌')).toBe(true);
      expect(measure(line)).toBeLessThanOrEqual(20);
    }
  });
});
