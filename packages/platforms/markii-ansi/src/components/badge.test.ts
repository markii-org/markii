import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { stripAnsi } from '../measure.js';

describe('Badge', () => {
  it('renders inverse-video chip text at color levels above none', () => {
    const out = renderMarkToAnsi(
      ':badge[New]{variant=success}\n',
      undefined,
      undefined,
      undefined,
      {
        color: '16',
      },
    );
    expect(out).toContain('\x1b[7m');
    expect(stripAnsi(out).trim()).toBe('New');
  });

  it('degrades to [label] at color level none', () => {
    const out = renderMarkToAnsi(':badge[New]\n');
    expect(out.trim()).toBe('[New]');
  });

  it('an invalid variant falls back to neutral without throwing', () => {
    const out = stripAnsi(
      renderMarkToAnsi(
        ':badge[X]{variant=bogus}\n',
        undefined,
        undefined,
        undefined,
        { color: '16' },
      ),
    );
    expect(out).toContain('X');
  });
});
