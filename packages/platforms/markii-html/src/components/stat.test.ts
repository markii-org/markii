import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { renderMarkToHtml } from '../render.js';
import { defaultHtmlRegistry } from './index.js';

describe('Stat', () => {
  it('renders static attributes with no data binding', () => {
    const html = renderMarkToHtml(
      '::stat{value=42 label="stars" delta=+3 trend=up}\n',
      defaultHtmlRegistry,
    );
    expect(html).toContain('<div class="mk-stat">');
    expect(html).toContain('<div class="mk-stat__value">42</div>');
    expect(html).toContain('<div class="mk-stat__label">stars</div>');
    expect(html).toContain(
      '<span class="mk-stat__delta mk-stat__delta--up">+3</span>',
    );
  });

  it('renders — with no value at all', () => {
    const html = renderMarkToHtml('::stat\n', defaultHtmlRegistry);
    expect(html).toContain('<div class="mk-stat__value">—</div>');
  });

  it('a bound number supplies the value', () => {
    const store = createValueStore({
      stars: { value: 7, status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::stat{data=stars label="stars"}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<div class="mk-stat__value">7</div>');
  });

  it('a bound object supplies value/label/delta/trend, explicit attributes win', () => {
    const store = createValueStore({
      repo: {
        value: { value: 9, label: 'from-data', delta: '-1', trend: 'down' },
        status: 'fresh',
      },
    });
    const html = renderMarkToHtml(
      '::stat{data=repo label="explicit"}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<div class="mk-stat__value">9</div>');
    expect(html).toContain('<div class="mk-stat__label">explicit</div>');
    expect(html).toContain('mk-stat__delta--down">-1</span>');
  });

  it('a missing binding renders — with a title-less mk-stat', () => {
    const html = renderMarkToHtml(
      '::stat{data=missing}\n',
      defaultHtmlRegistry,
      createValueStore(),
    );
    expect(html).toContain('<div class="mk-stat__value">—</div>');
    expect(html).not.toContain('mk-stat--');
  });

  it('a stale binding adds the stale modifier class', () => {
    const store = createValueStore({
      stars: { value: 5, status: 'stale' },
    });
    const html = renderMarkToHtml(
      '::stat{data=stars}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('class="mk-stat mk-stat--stale"');
  });

  it('an error binding with a failure kind adds the kind class and a title tooltip', () => {
    const store = createValueStore({
      stars: {
        value: undefined,
        status: 'error',
        error: 'boom',
        failureKind: 'tier-blocked',
      },
    });
    const html = renderMarkToHtml(
      '::stat{data=stars}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('mk-stat--tier-blocked');
    expect(html).toContain('title="requires manual run: boom"');
    expect(html).toContain('<div class="mk-stat__value">—</div>');
  });

  it('a hostile bound value never throws and degrades to the quiet empty body', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('trap');
        },
      },
    );
    const store = createValueStore({
      stars: { value: hostile, status: 'fresh' },
    });
    expect(() =>
      renderMarkToHtml('::stat{data=stars}\n', defaultHtmlRegistry, store),
    ).not.toThrow();
    const html = renderMarkToHtml(
      '::stat{data=stars}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<div class="mk-stat__value">—</div>');
  });

  describe('format/decimals (docs/format.md)', () => {
    it('formats the headline value with format=compact', () => {
      const html = renderMarkToHtml(
        '::stat{value=2301234 format=compact}\n',
        defaultHtmlRegistry,
      );
      expect(html).toContain('<div class="mk-stat__value">2.3M</div>');
    });

    it('an absent format keeps exactly the unformatted value', () => {
      const html = renderMarkToHtml(
        '::stat{value=2301234}\n',
        defaultHtmlRegistry,
      );
      expect(html).toContain('<div class="mk-stat__value">2301234</div>');
    });

    it("matches @markii/react's formatting for the same input (round-trip guard)", () => {
      // Both engines route through @markii/stdlib's formatValue, so a
      // number/percent/date reads identically in both — see stat.test.tsx.
      const html = renderMarkToHtml(
        '::stat{value=0.123 format=percent decimals=1}\n',
        defaultHtmlRegistry,
      );
      expect(html).toContain('<div class="mk-stat__value">12.3%</div>');
    });
  });
});
