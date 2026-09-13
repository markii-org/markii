import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { stripAnsi } from '../measure.js';

describe('Kbd', () => {
  it('renders bracketed bold text', () => {
    const out = stripAnsi(renderMarkToAnsi(':kbd[Ctrl+S]\n'));
    expect(out.trim()).toBe('[Ctrl+S]');
  });

  it('is bold when color is enabled', () => {
    const out = renderMarkToAnsi(':kbd[X]\n', undefined, undefined, undefined, {
      color: '16',
    });
    expect(out).toContain('\x1b[1m');
  });
});
