import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createValueStore } from '@markii/runtime';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

describe('Chart', () => {
  it('renders a line chart (a polyline) from static `values`', () => {
    const { container } = render(
      renderMark('::chart{kind=line values="1,3,2,5"}', defaultRegistry),
    );
    const svg = container.querySelector('svg.mk-chart');
    expect(svg).not.toBeNull();
    const line = svg?.querySelector('polyline.mk-chart__line');
    expect(line).not.toBeNull();
    expect(line?.getAttribute('points')?.split(' ')).toHaveLength(4);
  });

  it('renders a bar chart (one <rect> per point) from static `values`', () => {
    const { container } = render(
      renderMark('::chart{kind=bar values="1,3,2,5"}', defaultRegistry),
    );
    const svg = container.querySelector('svg.mk-chart');
    expect(svg?.querySelectorAll('rect.mk-chart__bar')).toHaveLength(4);
  });

  it('defaults to a line chart when `kind` is absent or invalid', () => {
    const { container: absent } = render(
      renderMark('::chart{values="1,2,3"}', defaultRegistry),
    );
    expect(absent.querySelector('polyline.mk-chart__line')).not.toBeNull();

    const { container: invalid } = render(
      renderMark('::chart{kind=pie values="1,2,3"}', defaultRegistry),
    );
    expect(invalid.querySelector('polyline.mk-chart__line')).not.toBeNull();
  });

  it('builds the chart from a bound `data` array of numbers, taking priority over `values`', () => {
    const store = createValueStore({
      spark: { value: [1, 5, 2, 8], status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark(
        '::chart{data=spark kind=bar values="9,9"}',
        defaultRegistry,
        store,
      ),
    );
    expect(container.querySelectorAll('rect.mk-chart__bar')).toHaveLength(4);
  });

  it('builds the chart from a bound `data` array of `{value}` objects', () => {
    const store = createValueStore({
      spark: {
        value: [{ value: 1 }, { value: 4 }, { value: 2 }],
        status: 'fresh',
        ranAt: 1,
      },
    });
    const { container } = render(
      renderMark('::chart{data=spark kind=bar}', defaultRegistry, store),
    );
    expect(container.querySelectorAll('rect.mk-chart__bar')).toHaveLength(3);
  });

  it('renders a neutral empty state for an empty series, never an <svg>', () => {
    const { container } = render(
      renderMark('::chart{values=""}', defaultRegistry),
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.mk-chart--empty')).not.toBeNull();
  });

  it('renders a neutral empty state when data is missing/error and there is no static fallback', () => {
    const missingStore = createValueStore();
    const { container: missing } = render(
      renderMark('::chart{data=spark}', defaultRegistry, missingStore),
    );
    expect(missing.querySelector('svg')).toBeNull();
    expect(missing.querySelector('.mk-chart--empty')).not.toBeNull();

    const errorStore = createValueStore({
      spark: { value: [1, 2, 3], status: 'error', error: 'boom' },
    });
    const { container: errored } = render(
      renderMark('::chart{data=spark}', defaultRegistry, errorStore),
    );
    expect(errored.querySelector('svg')).toBeNull();
    expect(errored.querySelector('.mk-chart--empty')).not.toBeNull();
  });

  it('filters a hostile `data` array (strings, NaN, Infinity, objects, nulls) without throwing, and emits no NaN in the SVG', () => {
    const store = createValueStore({
      hostile: {
        value: [
          1,
          'not a number',
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.NEGATIVE_INFINITY,
          { nope: true },
          null,
          undefined,
          3,
          '<script>alert(1)</script>',
        ],
        status: 'fresh',
        ranAt: 1,
      },
    });

    expect(() =>
      render(
        renderMark('::chart{data=hostile kind=line}', defaultRegistry, store),
      ),
    ).not.toThrow();

    const { container } = render(
      renderMark('::chart{data=hostile kind=line}', defaultRegistry, store),
    );
    const line = container.querySelector('polyline.mk-chart__line');
    expect(line).not.toBeNull();
    // Only the two finite numeric entries (1, 3) survive filtering.
    expect(line?.getAttribute('points')?.split(' ')).toHaveLength(2);
    expect(line?.getAttribute('points') ?? '').not.toMatch(/NaN/);
    expect(container.innerHTML).not.toContain('<script>');
    expect(container.querySelector('script')).toBeNull();
  });

  it('caps a large series to a bounded number of rendered points', () => {
    const huge = Array.from({ length: 5000 }, (_, i) => i);
    const store = createValueStore({
      huge: { value: huge, status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::chart{data=huge kind=bar}', defaultRegistry, store),
    );
    const bars = container.querySelectorAll('rect.mk-chart__bar');
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.length).toBeLessThanOrEqual(200);
  });

  it('drops non-numeric tokens from static `values` without throwing', () => {
    expect(() =>
      render(renderMark('::chart{values="1,oops,3,,NaN,5"}', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(
      renderMark('::chart{values="1,oops,3,,NaN,5"}', defaultRegistry),
    );
    const line = container.querySelector('polyline.mk-chart__line');
    expect(line?.getAttribute('points')?.split(' ')).toHaveLength(3);
  });

  it('gives the SVG an accessible title via aria-label', () => {
    const { container } = render(
      renderMark('::chart{values="1,2,3"}', defaultRegistry),
    );
    const svg = container.querySelector('svg.mk-chart');
    expect(svg?.getAttribute('aria-label')).toBeTruthy();
    expect(svg?.getAttribute('role')).toBe('img');
  });

  it('emits finite geometry (no NaN/Infinity) for float-limit endpoints whose difference overflows, as a line chart', () => {
    const store = createValueStore({
      overflow: { value: [1e308, -1e308], status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::chart{data=overflow kind=line}', defaultRegistry, store),
    );
    const svg = container.querySelector('svg.mk-chart');
    expect(svg).not.toBeNull();
    const line = svg?.querySelector('polyline.mk-chart__line');
    const points = line?.getAttribute('points') ?? '';
    expect(points).not.toBe('');
    expect(points).not.toMatch(/NaN/);
    expect(points).not.toMatch(/Infinity/);
    for (const coord of points.split(/[ ,]/)) {
      expect(Number.isFinite(Number(coord))).toBe(true);
    }
  });

  it('emits finite geometry (no NaN/Infinity) for float-limit endpoints whose difference overflows, as a bar chart', () => {
    const store = createValueStore({
      overflow: { value: [1e308, -1e308], status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::chart{data=overflow kind=bar}', defaultRegistry, store),
    );
    const bars = container.querySelectorAll('rect.mk-chart__bar');
    expect(bars.length).toBe(2);
    for (const bar of Array.from(bars)) {
      for (const attr of ['x', 'y', 'width', 'height']) {
        const raw = bar.getAttribute(attr) ?? '';
        expect(raw).not.toMatch(/NaN/);
        expect(raw).not.toMatch(/Infinity/);
        expect(Number.isFinite(Number(raw))).toBe(true);
      }
    }
  });

  it('emits finite geometry for a three-point overflow series', () => {
    const store = createValueStore({
      overflow3: { value: [1e308, -1e308, 5e307], status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::chart{data=overflow3 kind=line}', defaultRegistry, store),
    );
    const line = container.querySelector('polyline.mk-chart__line');
    const points = line?.getAttribute('points') ?? '';
    expect(points).not.toMatch(/NaN/);
    expect(points).not.toMatch(/Infinity/);
    expect(points.split(' ')).toHaveLength(3);
    for (const coord of points.split(/[ ,]/)) {
      expect(Number.isFinite(Number(coord))).toBe(true);
    }
  });

  it('clamps an absurdly large `width`/`height` attribute to a sane maximum instead of a giant viewBox', () => {
    const { container } = render(
      renderMark('::chart{values="1,2,3" width="1e9"}', defaultRegistry),
    );
    const svg = container.querySelector('svg.mk-chart');
    const width = Number(svg?.getAttribute('width'));
    expect(width).toBeLessThan(1e9);
    expect(width).toBeLessThanOrEqual(2000);
    expect(svg?.getAttribute('viewBox')).not.toMatch(/1000000000/);

    const { container: heightContainer } = render(
      renderMark('::chart{values="1,2,3" height="1e9"}', defaultRegistry),
    );
    const heightSvg = heightContainer.querySelector('svg.mk-chart');
    const height = Number(heightSvg?.getAttribute('height'));
    expect(height).toBeLessThan(1e9);
    expect(height).toBeLessThanOrEqual(2000);
  });

  it('does not regress the happy-path geometry for a normal series', () => {
    const { container } = render(
      renderMark('::chart{kind=line values="1,3,2,5"}', defaultRegistry),
    );
    const line = container.querySelector('polyline.mk-chart__line');
    const points = line?.getAttribute('points') ?? '';
    const coords = points.split(' ').map((pair) => pair.split(',').map(Number));
    expect(coords).toHaveLength(4);
    for (const [x, y] of coords) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    // width=240 (default), PADDING=4 -> first x = 4, last x = 236.
    expect(coords[0]?.[0]).toBeCloseTo(4);
    expect(coords[3]?.[0]).toBeCloseTo(236);
    // min=1 (bottom, y=56), max=5 (top, y=4).
    expect(coords[0]?.[1]).toBeCloseTo(56);
    expect(coords[3]?.[1]).toBeCloseTo(4);

    const { container: barContainer } = render(
      renderMark('::chart{kind=bar values="1,3,2,5"}', defaultRegistry),
    );
    const bars = barContainer.querySelectorAll('rect.mk-chart__bar');
    expect(bars).toHaveLength(4);
    for (const bar of Array.from(bars)) {
      for (const attr of ['x', 'y', 'width', 'height']) {
        expect(Number.isFinite(Number(bar.getAttribute(attr)))).toBe(true);
      }
    }
  });
});
