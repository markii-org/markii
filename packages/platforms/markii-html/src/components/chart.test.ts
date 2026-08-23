import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { renderMarkToHtml } from '../render.js';
import { defaultHtmlRegistry } from './index.js';

describe('Chart', () => {
  it('renders a line chart from static values', () => {
    const html = renderMarkToHtml(
      '::chart{values="1,3,2,5"}\n',
      defaultHtmlRegistry,
    );
    expect(html).toContain('<svg class="mk-chart"');
    expect(html).toContain('<polyline class="mk-chart__line"');
    expect(html).toContain('aria-label="line chart, 4 points"');
  });

  it('renders a bar chart when kind=bar', () => {
    const html = renderMarkToHtml(
      '::chart{kind=bar values="1,2,3"}\n',
      defaultHtmlRegistry,
    );
    expect(html).toContain('<rect class="mk-chart__bar"');
    expect(html).not.toContain('polyline');
  });

  it('renders the neutral empty state with no data and no static values', () => {
    const html = renderMarkToHtml('::chart\n', defaultHtmlRegistry);
    expect(html).toContain('mk-chart mk-chart--empty');
    expect(html).toContain('no data');
    expect(html).not.toContain('<svg');
  });

  it('a bound array of numbers takes priority over static values', () => {
    const store = createValueStore({
      series: { value: [10, 20, 30], status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::chart{data=series values="1,1,1"}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('aria-label="line chart, 3 points"');
  });

  it('a bound array of {value} objects is coerced', () => {
    const store = createValueStore({
      series: { value: [{ value: 1 }, { value: 2 }], status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::chart{data=series}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('aria-label="line chart, 2 points"');
  });

  it('never emits NaN/Infinity coordinates for hostile input', () => {
    const store = createValueStore({
      series: {
        value: [1, Number.NaN, Number.POSITIVE_INFINITY, 2],
        status: 'fresh',
      },
    });
    const html = renderMarkToHtml(
      '::chart{data=series}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('a stale binding adds the stale modifier class', () => {
    const store = createValueStore({
      series: { value: [1, 2], status: 'stale' },
    });
    const html = renderMarkToHtml(
      '::chart{data=series}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('mk-chart mk-chart--stale');
  });

  it('a hostile bound value never throws', () => {
    const hostile = new Proxy([1, 2, 3], {
      get(target, prop) {
        if (prop === Symbol.iterator) {
          throw new Error('trap');
        }
        return (target as unknown as Record<PropertyKey, unknown>)[
          prop as string
        ];
      },
    });
    const store = createValueStore({
      series: { value: hostile, status: 'fresh' },
    });
    expect(() =>
      renderMarkToHtml('::chart{data=series}\n', defaultHtmlRegistry, store),
    ).not.toThrow();
  });
});
