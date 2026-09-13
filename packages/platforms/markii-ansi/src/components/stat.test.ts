import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { renderMarkToAnsi } from '../render.js';
import { stripAnsi } from '../measure.js';

describe('Stat', () => {
  it('renders a label line and a bold value line', () => {
    const out = stripAnsi(renderMarkToAnsi('::stat{value=42 label="stars"}\n'));
    expect(out).toContain('stars');
    expect(out).toContain('42');
  });

  it('renders — when the value is missing from both sources', () => {
    const out = renderMarkToAnsi('::stat\n');
    expect(out).toContain('—');
  });

  it('a bound object supplies value/label/delta/trend, attributes taking precedence', () => {
    const store = createValueStore({
      s: {
        value: { value: 10, label: 'from data', delta: '+2', trend: 'up' },
        status: 'fresh',
      },
    });
    const out = renderMarkToAnsi(
      '::stat{data=s label="explicit"}\n',
      undefined,
      store,
    );
    expect(out).toContain('10');
    expect(out).toContain('explicit');
    expect(out).toContain('+2');
  });

  it('a failed binding appends the quiet failure suffix', () => {
    const store = createValueStore({
      s: {
        value: undefined,
        status: 'error',
        failureKind: 'capability-denied',
      },
    });
    const out = renderMarkToAnsi('::stat{data=s value=5}\n', undefined, store);
    expect(out).toContain('needs permission');
  });

  it('format/decimals format the headline value', () => {
    const out = renderMarkToAnsi('::stat{value=1234 format=compact}\n');
    expect(out.toLowerCase()).toContain('k');
  });
});
