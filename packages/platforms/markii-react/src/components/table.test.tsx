import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createValueStore } from '@markii/runtime';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

describe('Table — array of objects', () => {
  it('columns are the union of keys in first-seen order, header + one row per entry', () => {
    const store = createValueStore({
      users: {
        value: [
          { name: 'Ann', role: 'lead' },
          { name: 'Bo', role: 'dev', team: 'core' },
        ],
        status: 'fresh',
        ranAt: 1,
      },
    });
    const { container } = render(
      renderMark('::table{data=users}', defaultRegistry, store),
    );
    const table = container.querySelector('.mk-table');
    expect(table).not.toBeNull();
    const headers = Array.from(table!.querySelectorAll('thead th')).map(
      (th) => th.textContent,
    );
    expect(headers).toEqual(['name', 'role', 'team']);
    const rows = table!.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[1]!.querySelectorAll('td')[2]).toHaveTextContent('core');
    // a key the first row doesn't have renders an empty cell
    expect(rows[0]!.querySelectorAll('td')[2]).toHaveTextContent('');
  });

  it('columns= reorders/restricts the shown columns', () => {
    const store = createValueStore({
      users: {
        value: [{ name: 'Ann', role: 'lead', team: 'x' }],
        status: 'fresh',
        ranAt: 1,
      },
    });
    const { container } = render(
      renderMark(
        '::table{data=users columns="role,name"}',
        defaultRegistry,
        store,
      ),
    );
    const headers = Array.from(container.querySelectorAll('thead th')).map(
      (th) => th.textContent,
    );
    expect(headers).toEqual(['role', 'name']);
  });

  it('limit= caps the number of rows shown', () => {
    const store = createValueStore({
      users: {
        value: [{ n: 1 }, { n: 2 }, { n: 3 }],
        status: 'fresh',
        ranAt: 1,
      },
    });
    const { container } = render(
      renderMark('::table{data=users limit=2}', defaultRegistry, store),
    );
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('an invalid limit (0, negative, non-integer) shows every row', () => {
    const store = createValueStore({
      users: { value: [{ n: 1 }, { n: 2 }], status: 'fresh', ranAt: 1 },
    });
    for (const limit of ['0', '-1', 'abc', '1.5']) {
      const { container } = render(
        renderMark(
          `::table{data=users limit=${limit}}`,
          defaultRegistry,
          store,
        ),
      );
      expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    }
  });
});

describe('Table — array of arrays', () => {
  it('renders rows exactly as given, with no header row', () => {
    const store = createValueStore({
      grid: {
        value: [
          [1, 2],
          [3, 4],
        ],
        status: 'fresh',
        ranAt: 1,
      },
    });
    const { container } = render(
      renderMark('::table{data=grid}', defaultRegistry, store),
    );
    expect(container.querySelector('thead')).toBeNull();
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelectorAll('td')).toHaveLength(2);
  });
});

describe('Table — array of primitives', () => {
  it('renders one column, one cell per row', () => {
    const store = createValueStore({
      names: { value: ['a', 'b', 'c'], status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::table{data=names}', defaultRegistry, store),
    );
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    for (const row of Array.from(rows)) {
      expect(row.querySelectorAll('td')).toHaveLength(1);
    }
  });
});

describe('Table — single object', () => {
  it('renders key/value rows', () => {
    const store = createValueStore({
      info: { value: { a: 1, b: 2 }, status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::table{data=info}', defaultRegistry, store),
    );
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('th')).toHaveTextContent('a');
    expect(rows[0]!.querySelector('td')).toHaveTextContent('1');
  });
});

describe('Table — caption and text alignment', () => {
  it('renders a caption when given', () => {
    const store = createValueStore({
      xs: { value: [1, 2], status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::table{data=xs caption="My table"}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-table__caption')).toHaveTextContent(
      'My table',
    );
  });

  it('applies the text= class', () => {
    const store = createValueStore({
      xs: { value: [1, 2], status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::table{data=xs text=center}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-table')).toHaveClass('mk-text-center');
  });
});

describe('Table — format/decimals apply to numeric cells only', () => {
  it('formats numeric cells, leaves text cells untouched', () => {
    const store = createValueStore({
      rows: {
        value: [
          { amount: 2301234, label: 'total' },
          { amount: 500, label: 'partial' },
        ],
        status: 'fresh',
        ranAt: 1,
      },
    });
    const { container } = render(
      renderMark(
        '::table{data=rows columns="label,amount" format=compact}',
        defaultRegistry,
        store,
      ),
    );
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0]!.querySelectorAll('td')[0]).toHaveTextContent('total');
    expect(rows[0]!.querySelectorAll('td')[1]).toHaveTextContent('2.3M');
    expect(rows[1]!.querySelectorAll('td')[1]).toHaveTextContent('500');
  });

  it('an absent format renders numbers as plain text', () => {
    const store = createValueStore({
      rows: { value: [{ n: 2301234 }], status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::table{data=rows}', defaultRegistry, store),
    );
    expect(container.querySelector('tbody td')).toHaveTextContent('2301234');
  });
});

describe('Table — missing/stale/error binding', () => {
  it('renders a quiet empty state with no store', () => {
    const { container } = render(
      renderMark('::table{data=nope}', defaultRegistry),
    );
    const table = container.querySelector('.mk-table');
    expect(table).toHaveClass('mk-table--empty');
    expect(table?.querySelector('table')).toBeNull();
    expect(table).toHaveTextContent('no data');
  });

  it('a stale binding still renders, with the stale modifier class', () => {
    const store = createValueStore({
      xs: { value: [1, 2], status: 'stale' },
    });
    const { container } = render(
      renderMark('::table{data=xs}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-table')).toHaveClass('mk-table--stale');
  });

  it('an error binding degrades to the empty state with a failure-kind class and tooltip', () => {
    const store = createValueStore({
      xs: {
        value: undefined,
        status: 'error',
        error: 'boom',
        failureKind: 'script-error',
      },
    });
    const { container } = render(
      renderMark('::table{data=xs}', defaultRegistry, store),
    );
    const table = container.querySelector('.mk-table');
    expect(table).toHaveClass('mk-table--script-error');
    expect(table?.getAttribute('title')).toContain('script error');
  });

  it('an empty array renders the same quiet empty state, not an error', () => {
    const store = createValueStore({
      xs: { value: [], status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark('::table{data=xs}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-table')).toHaveClass('mk-table--empty');
  });
});

describe('Table — hostile bound value never throws', () => {
  it('a Proxy whose key enumeration throws degrades to the empty state', () => {
    const hostile = new Proxy(
      { a: 1 },
      {
        ownKeys() {
          throw new Error('trap');
        },
      },
    );
    const store = createValueStore({ xs: { value: hostile, status: 'fresh' } });
    expect(() =>
      render(renderMark('::table{data=xs}', defaultRegistry, store)),
    ).not.toThrow();
    const { container } = render(
      renderMark('::table{data=xs}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-table')).toHaveClass('mk-table--empty');
  });

  it('a revoked proxy element inside an array degrades without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
    revoke();
    const store = createValueStore({
      xs: { value: [proxy], status: 'fresh' },
    });
    expect(() =>
      render(renderMark('::table{data=xs}', defaultRegistry, store)),
    ).not.toThrow();
  });
});
