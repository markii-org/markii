import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { renderMarkToAnsi } from '../render.js';
import { stripAnsi } from '../measure.js';

describe('Chart', () => {
  it('renders a sparkline row with min/max labels for kind=line', () => {
    const out = stripAnsi(
      renderMarkToAnsi('::chart{kind=line values="1,3,2,5"}\n'),
    );
    expect(out).toContain('1');
    expect(out).toContain('5');
    expect(/[▁▂▃▄▅▆▇█]/.test(out)).toBe(true);
  });

  it('renders horizontal bars for kind=bar, one per point', () => {
    const out = stripAnsi(
      renderMarkToAnsi('::chart{kind=bar values="1,2,3"}\n'),
    );
    expect(out.trim().split('\n')).toHaveLength(3);
    expect(out).toContain('█');
  });

  it('renders a neutral empty state for no data rather than throwing', () => {
    const out = stripAnsi(renderMarkToAnsi('::chart\n'));
    expect(out).toContain('no data');
  });

  it('a bound data array of numbers takes priority over values=', () => {
    const store = createValueStore({
      c: { value: [10, 20, 30], status: 'fresh' },
    });
    const out = stripAnsi(
      renderMarkToAnsi(
        '::chart{kind=bar data=c values="1,2"}\n',
        undefined,
        store,
      ),
    );
    expect(out.trim().split('\n')).toHaveLength(3);
  });

  it('non-numeric entries are dropped rather than throwing', () => {
    expect(() => renderMarkToAnsi('::chart{values="a,b,1"}\n')).not.toThrow();
  });
});
