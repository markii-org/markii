import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createValueStore } from '@markii/runtime';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

function bar(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.mk-progress__bar');
}

describe('Progress', () => {
  it('renders a fraction from static value/max attributes', () => {
    const { container } = render(
      renderMark('::progress{value=1 max=4}', defaultRegistry),
    );
    const progress = container.querySelector('.mk-progress');
    expect(progress).toHaveAttribute('aria-valuenow', '1');
    expect(progress).toHaveAttribute('aria-valuemax', '4');
    expect(bar(container)).toHaveStyle({ width: '25%' });
    expect(container.querySelector('.mk-progress__percent')).toHaveTextContent(
      '25%',
    );
  });

  it('defaults max to 1 when absent', () => {
    const { container } = render(
      renderMark('::progress{value=0.5}', defaultRegistry),
    );
    expect(bar(container)).toHaveStyle({ width: '50%' });
  });

  it('renders the optional label', () => {
    const { container } = render(
      renderMark('::progress{value=1 max=2 label="tasks"}', defaultRegistry),
    );
    expect(container.querySelector('.mk-progress__label')).toHaveTextContent(
      'tasks',
    );
  });

  it('clamps a value above max to 100%', () => {
    const { container } = render(
      renderMark('::progress{value=99 max=4}', defaultRegistry),
    );
    expect(bar(container)).toHaveStyle({ width: '100%' });
  });

  it('clamps a negative value to 0%', () => {
    const { container } = render(
      renderMark('::progress{value=-5 max=4}', defaultRegistry),
    );
    expect(bar(container)).toHaveStyle({ width: '0%' });
  });

  it('treats non-numeric value as 0 rather than throwing', () => {
    expect(() =>
      render(renderMark('::progress{value=nonsense}', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(
      renderMark('::progress{value=nonsense}', defaultRegistry),
    );
    expect(bar(container)).toHaveStyle({ width: '0%' });
  });

  it('falls back to the default max for a non-positive/NaN/Infinity max', () => {
    const { container: withZero } = render(
      renderMark('::progress{value=1 max=0}', defaultRegistry),
    );
    expect(bar(withZero)).toHaveStyle({ width: '100%' });

    const { container: withInfinity } = render(
      renderMark('::progress{value=1 max=Infinity}', defaultRegistry),
    );
    expect(bar(withInfinity)).toHaveStyle({ width: '100%' });
  });

  it('renders a 0% bar and no crash when there is no value/max at all', () => {
    expect(() =>
      render(renderMark('::progress', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(renderMark('::progress', defaultRegistry));
    expect(bar(container)).toHaveStyle({ width: '0%' });
  });

  it('uses a bound number `data` value as the value', () => {
    const store = createValueStore({
      done: { value: 3, status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::progress{data=done max=4}', defaultRegistry, store),
    );
    expect(bar(container)).toHaveStyle({ width: '75%' });
  });

  it('reads value/max fields off a bound object `data` value', () => {
    const store = createValueStore();
    store.set('task', {
      value: { value: 2, max: 8 },
      status: 'fresh',
      ranAt: 1,
    });
    const { container } = render(
      renderMark('::progress{data=task}', defaultRegistry, store),
    );
    expect(bar(container)).toHaveStyle({ width: '25%' });
  });

  it("lets explicit attributes override the bound object's fields", () => {
    const store = createValueStore();
    store.set('task', {
      value: { value: 2, max: 8 },
      status: 'fresh',
      ranAt: 1,
    });
    const { container } = render(
      renderMark('::progress{data=task max=4}', defaultRegistry, store),
    );
    expect(bar(container)).toHaveStyle({ width: '50%' });
  });

  it('degrades to a 0% bar when the bound data is missing or errored', () => {
    const missingStore = createValueStore();
    const { container: missing } = render(
      renderMark('::progress{data=done}', defaultRegistry, missingStore),
    );
    expect(bar(missing)).toHaveStyle({ width: '0%' });

    const errorStore = createValueStore({
      done: { value: 999, status: 'error', error: 'boom' },
    });
    const { container: errored } = render(
      renderMark('::progress{data=done}', defaultRegistry, errorStore),
    );
    expect(bar(errored)).toHaveStyle({ width: '0%' });
  });

  describe('format/decimals (docs/format.md)', () => {
    it('an absent format keeps the default rounded integer percent', () => {
      const { container } = render(
        renderMark('::progress{value=1 max=3}', defaultRegistry),
      );
      expect(
        container.querySelector('.mk-progress__percent'),
      ).toHaveTextContent('33%');
    });

    it('format=percent with decimals shows fractional percent', () => {
      const { container } = render(
        renderMark(
          '::progress{value=1 max=3 format=percent decimals=1}',
          defaultRegistry,
        ),
      );
      expect(
        container.querySelector('.mk-progress__percent'),
      ).toHaveTextContent('33.3%');
    });
  });
});
