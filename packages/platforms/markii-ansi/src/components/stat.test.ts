import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { renderMarkToAnsi } from '../render.js';
import { stripEscapes } from '../text-grid.js';

describe('Stat', () => {
  it('renders a label line and a bold value line', async () => {
    const out = stripEscapes(
      await renderMarkToAnsi('::stat{value=42 label="stars"}\n'),
    );
    expect(out).toContain('stars');
    expect(out).toContain('42');
  });

  it('renders — when the value is missing from both sources', async () => {
    const out = await renderMarkToAnsi('::stat\n');
    expect(out).toContain('—');
  });

  it('a bound object supplies value/label/delta/trend, attributes taking precedence', async () => {
    const store = createValueStore({
      s: {
        value: { value: 10, label: 'from data', delta: '+2', trend: 'up' },
        status: 'fresh',
      },
    });
    const out = await renderMarkToAnsi(
      '::stat{data=s label="explicit"}\n',
      undefined,
      store,
    );
    expect(out).toContain('10');
    expect(out).toContain('explicit');
    expect(out).toContain('+2');
  });

  it('a failed binding appends the quiet failure suffix', async () => {
    const store = createValueStore({
      s: {
        value: undefined,
        status: 'error',
        failureKind: 'capability-denied',
      },
    });
    const out = await renderMarkToAnsi(
      '::stat{data=s value=5}\n',
      undefined,
      store,
    );
    expect(out).toContain('needs permission');
  });

  it('format/decimals format the headline value', async () => {
    const out = await renderMarkToAnsi('::stat{value=1234 format=compact}\n');
    expect(out.toLowerCase()).toContain('k');
  });
});
