import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createValueStore } from '@markii/runtime';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

describe('Stat', () => {
  it('renders static attributes with no data binding', () => {
    const { container } = render(
      renderMark(
        '::stat{value=42 label="stars" delta="+3" trend=up}',
        defaultRegistry,
      ),
    );
    const stat = container.querySelector('.mk-stat');
    expect(stat).not.toBeNull();
    expect(stat?.querySelector('.mk-stat__value')).toHaveTextContent('42');
    expect(stat?.querySelector('.mk-stat__label')).toHaveTextContent('stars');
    const delta = stat?.querySelector('.mk-stat__delta');
    expect(delta).toHaveTextContent('+3');
    expect(delta).toHaveClass('mk-stat__delta--up');
  });

  it('renders `—` when no value is available from attribute or data', () => {
    const { container } = render(
      renderMark('::stat{label="nothing yet"}', defaultRegistry),
    );
    expect(container.querySelector('.mk-stat__value')).toHaveTextContent('—');
  });

  it('uses a bound number `data` value as the stat value', () => {
    const store = createValueStore({
      stars: { value: 128, status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::stat{data=stars label="stars"}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-stat__value')).toHaveTextContent('128');
  });

  it('uses a bound string `data` value as the stat value', () => {
    const store = createValueStore({
      status: { value: 'Online', status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::stat{data=status}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-stat__value')).toHaveTextContent(
      'Online',
    );
  });

  it('reads value/label/delta/trend fields off a bound object `data` value', () => {
    const store = createValueStore();
    store.set('repo', {
      value: { value: 99, label: 'forks', delta: '-1', trend: 'down' },
      status: 'fresh',
      ranAt: 1,
    });
    const { container } = render(
      renderMark('::stat{data=repo}', defaultRegistry, store),
    );
    const stat = container.querySelector('.mk-stat');
    expect(stat?.querySelector('.mk-stat__value')).toHaveTextContent('99');
    expect(stat?.querySelector('.mk-stat__label')).toHaveTextContent('forks');
    const delta = stat?.querySelector('.mk-stat__delta');
    expect(delta).toHaveTextContent('-1');
    expect(delta).toHaveClass('mk-stat__delta--down');
  });

  it("lets an explicit directive attribute override the bound object's field", () => {
    const store = createValueStore();
    store.set('repo', {
      value: { value: 99, label: 'forks' },
      status: 'fresh',
      ranAt: 1,
    });
    const { container } = render(
      renderMark(
        '::stat{data=repo label="overridden"}',
        defaultRegistry,
        store,
      ),
    );
    const stat = container.querySelector('.mk-stat');
    expect(stat?.querySelector('.mk-stat__value')).toHaveTextContent('99');
    expect(stat?.querySelector('.mk-stat__label')).toHaveTextContent(
      'overridden',
    );
  });

  it('degrades to `—` when the bound data is missing, never throwing', () => {
    const store = createValueStore();
    expect(() =>
      render(renderMark('::stat{data=stars}', defaultRegistry, store)),
    ).not.toThrow();
    const { container } = render(
      renderMark('::stat{data=stars}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-stat__value')).toHaveTextContent('—');
  });

  it('degrades to `—` when the bound data errored, ignoring any stale error value', () => {
    const store = createValueStore({
      stars: { value: 999, status: 'error', error: 'boom' },
    });
    const { container } = render(
      renderMark('::stat{data=stars}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-stat__value')).toHaveTextContent('—');
  });

  it('falls back to `neutral` (no trend class) for an invalid trend value', () => {
    const { container } = render(
      renderMark('::stat{value=1 delta="x" trend=sideways}', defaultRegistry),
    );
    const delta = container.querySelector('.mk-stat__delta');
    expect(delta).not.toHaveClass('mk-stat__delta--up');
    expect(delta).not.toHaveClass('mk-stat__delta--down');
    expect(delta).not.toHaveClass('mk-stat__delta--flat');
  });

  describe('format/decimals (docs/format.md)', () => {
    it('formats the headline value with format=compact', () => {
      const { container } = render(
        renderMark('::stat{value=2301234 format=compact}', defaultRegistry),
      );
      expect(container.querySelector('.mk-stat__value')).toHaveTextContent(
        '2.3M',
      );
    });

    it('formats a bound numeric data value with format=number and decimals', () => {
      const store = createValueStore({
        stars: { value: 2301234, status: 'fresh', ranAt: 1 },
      });
      const { container } = render(
        renderMark(
          '::stat{data=stars format=number decimals=2}',
          defaultRegistry,
          store,
        ),
      );
      expect(container.querySelector('.mk-stat__value')).toHaveTextContent(
        '2,301,234.00',
      );
    });

    it('leaves a non-numeric value unchanged under a numeric format', () => {
      const { container } = render(
        renderMark(
          '::stat{value="not a number" format=percent}',
          defaultRegistry,
        ),
      );
      expect(container.querySelector('.mk-stat__value')).toHaveTextContent(
        'not a number',
      );
    });

    it('an absent format keeps exactly the unformatted value', () => {
      const { container } = render(
        renderMark('::stat{value=2301234}', defaultRegistry),
      );
      expect(container.querySelector('.mk-stat__value')).toHaveTextContent(
        '2301234',
      );
    });
  });
});
