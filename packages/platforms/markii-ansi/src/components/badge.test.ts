import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { stripEscapes } from '../text-grid.js';

describe('Badge', () => {
  it('renders inverse-video chip text at color levels above none', async () => {
    const out = await renderMarkToAnsi(
      ':badge[New]{variant=success}\n',
      undefined,
      undefined,
      undefined,
      {
        color: '16',
      },
    );
    expect(out).toContain('\x1b[7m');
    expect(stripEscapes(out).trim()).toBe('New');
  });

  it('degrades to [label] at color level none', async () => {
    const out = await renderMarkToAnsi(':badge[New]\n');
    expect(out.trim()).toBe('[New]');
  });

  it('an invalid variant falls back to neutral without throwing', async () => {
    const out = stripEscapes(
      await renderMarkToAnsi(
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
