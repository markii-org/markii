import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { renderMarkToAnsi } from '../render.js';
import { stripEscapes } from '../text-grid.js';

describe('Progress', () => {
  it('renders a bar of filled/empty blocks and a percent readout', async () => {
    const out = stripEscapes(
      await renderMarkToAnsi('::progress{value=3 max=5 label="tasks"}\n'),
    );
    expect(out).toContain('tasks');
    expect(out).toContain('60%');
    expect(out).toContain('█');
    expect(out).toContain('░');
  });

  it('renders a 0% bar for missing/invalid input rather than throwing', async () => {
    const out = stripEscapes(await renderMarkToAnsi('::progress\n'));
    expect(out).toContain('0%');
  });

  it('clamps value to [0, max]', async () => {
    const out = stripEscapes(
      await renderMarkToAnsi('::progress{value=999 max=10}\n'),
    );
    expect(out).toContain('100%');
  });

  it('a bound data value supplies value/max', async () => {
    const store = createValueStore({
      p: { value: { value: 2, max: 4 }, status: 'fresh' },
    });
    const out = stripEscapes(
      await renderMarkToAnsi('::progress{data=p}\n', undefined, store),
    );
    expect(out).toContain('50%');
  });

  it('format=percent with decimals formats the fraction instead of the default rounded percent', async () => {
    const out = stripEscapes(
      await renderMarkToAnsi(
        '::progress{value=1 max=3 format=percent decimals=1}\n',
      ),
    );
    expect(out).toMatch(/33\.3%/);
  });
});
