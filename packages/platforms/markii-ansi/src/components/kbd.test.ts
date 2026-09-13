import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { stripEscapes } from '../text-grid.js';

describe('Kbd', () => {
  it('renders bracketed bold text', async () => {
    const out = stripEscapes(await renderMarkToAnsi(':kbd[Ctrl+S]\n'));
    expect(out.trim()).toBe('[Ctrl+S]');
  });

  it('is bold when color is enabled', async () => {
    const out = await renderMarkToAnsi(
      ':kbd[X]\n',
      undefined,
      undefined,
      undefined,
      {
        color: '16',
      },
    );
    expect(out).toContain('\x1b[1m');
  });
});
