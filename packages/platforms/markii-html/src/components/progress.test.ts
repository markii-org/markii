import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { renderMarkToHtml } from '../render.js';
import { defaultHtmlRegistry } from './index.js';

describe('Progress', () => {
  it('renders a bar from static attributes', () => {
    const html = renderMarkToHtml(
      '::progress{value=3 max=5 label="tasks"}\n',
      defaultHtmlRegistry,
    );
    expect(html).toContain('<span class="mk-progress__label">tasks</span>');
    expect(html).toContain('width: 60%');
    expect(html).toContain('<span class="mk-progress__percent">60%</span>');
    expect(html).toContain('aria-valuenow="3"');
    expect(html).toContain('aria-valuemax="5"');
  });

  it('renders a quiet 0% bar with no value at all', () => {
    const html = renderMarkToHtml('::progress\n', defaultHtmlRegistry);
    expect(html).toContain('<span class="mk-progress__percent">0%</span>');
  });

  it('a bound number supplies value; clamps to [0, max]', () => {
    const store = createValueStore({ done: { value: 99, status: 'fresh' } });
    const html = renderMarkToHtml(
      '::progress{data=done max=10}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('aria-valuenow="10"');
    expect(html).toContain('<span class="mk-progress__percent">100%</span>');
  });

  it('a bound object supplies value/max, explicit attributes win', () => {
    const store = createValueStore({
      progressData: { value: { value: 2, max: 4 }, status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::progress{data=progressData max=8}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('aria-valuemax="8"');
  });

  it('a stale binding adds the stale modifier class and a tooltip', () => {
    const store = createValueStore({
      done: { value: 1, status: 'stale', error: 'old run' },
    });
    const html = renderMarkToHtml(
      '::progress{data=done}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('mk-progress mk-progress--stale');
    expect(html).toContain('title="old run"');
  });

  it('a hostile bound value never throws', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
      },
    );
    const store = createValueStore({
      done: { value: hostile, status: 'fresh' },
    });
    expect(() =>
      renderMarkToHtml('::progress{data=done}\n', defaultHtmlRegistry, store),
    ).not.toThrow();
  });

  describe('format/decimals (docs/format.md)', () => {
    it('an absent format keeps the default rounded integer percent', () => {
      const html = renderMarkToHtml(
        '::progress{value=1 max=3}\n',
        defaultHtmlRegistry,
      );
      expect(html).toContain('<span class="mk-progress__percent">33%</span>');
    });

    it('format=percent with decimals shows fractional percent', () => {
      const html = renderMarkToHtml(
        '::progress{value=1 max=3 format=percent decimals=1}\n',
        defaultHtmlRegistry,
      );
      expect(html).toContain('<span class="mk-progress__percent">33.3%</span>');
    });
  });
});
