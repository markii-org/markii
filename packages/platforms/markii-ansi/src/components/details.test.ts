import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';

describe('Details', () => {
  it('renders the summary marker and body, always expanded', () => {
    const out = renderMarkToAnsi(':::details{title="More"}\nhello\n:::\n');
    expect(out).toContain('More');
    expect(out).toContain('hello');
  });

  it('defaults the title to "Details" when absent', () => {
    const out = renderMarkToAnsi(':::details\nhi\n:::\n');
    expect(out).toContain('Details');
  });

  it('uses a different glyph when `open` is present', () => {
    const closed = renderMarkToAnsi(':::details{title=X}\nbody\n:::\n');
    const open = renderMarkToAnsi(':::details{title=X open}\nbody\n:::\n');
    expect(closed).toContain('▸');
    expect(open).toContain('▾');
  });

  it('indents the body under the marker line', () => {
    const out = renderMarkToAnsi(':::details{title=X}\nhello\n:::\n');
    const lines = out.split('\n');
    const bodyLine = lines.find((line) => line.includes('hello'));
    expect(bodyLine?.startsWith('  ')).toBe(true);
  });
});
