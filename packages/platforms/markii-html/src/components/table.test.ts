import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { renderMarkToHtml } from '../render.js';
import { defaultHtmlRegistry } from './index.js';

describe('Table — array of objects', () => {
  it('columns are the union of keys in first-seen order, header + one row per entry', () => {
    const store = createValueStore({
      users: {
        value: [
          { name: 'Ann', role: 'lead' },
          { name: 'Bo', role: 'dev', team: 'core' },
        ],
        status: 'fresh',
      },
    });
    const html = renderMarkToHtml(
      '::table{data=users}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<th>name</th><th>role</th><th>team</th>');
    expect(html).toContain('<td>core</td>');
  });

  it('columns= reorders/restricts the shown columns', () => {
    const store = createValueStore({
      users: {
        value: [{ name: 'Ann', role: 'lead', team: 'x' }],
        status: 'fresh',
      },
    });
    const html = renderMarkToHtml(
      '::table{data=users columns="role,name"}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<th>role</th><th>name</th>');
  });

  it('limit= caps the number of rows shown', () => {
    const store = createValueStore({
      users: { value: [{ n: 1 }, { n: 2 }, { n: 3 }], status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::table{data=users limit=2}\n',
      defaultHtmlRegistry,
      store,
    );
    const tbody = html.match(/<tbody>.*<\/tbody>/)?.[0] ?? '';
    expect(tbody.match(/<tr>/g)?.length).toBe(2);
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
      },
    });
    const html = renderMarkToHtml(
      '::table{data=grid}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).not.toContain('<thead>');
    expect(html.match(/<tr>/g)?.length).toBe(2);
  });
});

describe('Table — array of primitives', () => {
  it('renders one column, one cell per row', () => {
    const store = createValueStore({
      names: { value: ['a', 'b', 'c'], status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::table{data=names}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html.match(/<td>/g)?.length).toBe(3);
  });
});

describe('Table — single object', () => {
  it('renders key/value rows', () => {
    const store = createValueStore({
      info: { value: { a: 1, b: 2 }, status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::table{data=info}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<th scope="row">a</th><td>1</td>');
  });
});

describe('Table — caption and text alignment', () => {
  it('renders a caption when given', () => {
    const store = createValueStore({
      xs: { value: [1, 2], status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::table{data=xs caption="My table"}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<div class="mk-table__caption">My table</div>');
  });

  it('applies the text= class', () => {
    const store = createValueStore({
      xs: { value: [1, 2], status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::table{data=xs text=center}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('mk-text-center');
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
      },
    });
    const html = renderMarkToHtml(
      '::table{data=rows columns="label,amount" format=compact}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<td>total</td><td>2.3M</td>');
    expect(html).toContain('<td>partial</td><td>500</td>');
  });

  it('an absent format renders numbers as plain text', () => {
    const store = createValueStore({
      rows: { value: [{ n: 2301234 }], status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::table{data=rows}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<td>2301234</td>');
  });

  it("matches @markii/react's output for the same input (round-trip guard)", () => {
    const store = createValueStore({
      rows: { value: [{ n: 0.123 }], status: 'fresh' },
    });
    const html = renderMarkToHtml(
      '::table{data=rows format=percent decimals=1}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('<td>12.3%</td>');
  });
});

describe('Table — missing/stale/error binding', () => {
  it('renders a quiet empty state with no store', () => {
    const html = renderMarkToHtml('::table{data=nope}\n', defaultHtmlRegistry);
    expect(html).toContain('mk-table mk-table--empty');
    expect(html).not.toContain('<table');
    expect(html).toContain('no data');
  });

  it('a stale binding still renders, with the stale modifier class', () => {
    const store = createValueStore({ xs: { value: [1, 2], status: 'stale' } });
    const html = renderMarkToHtml(
      '::table{data=xs}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('mk-table--stale');
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
    const html = renderMarkToHtml(
      '::table{data=xs}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('mk-table--script-error');
    expect(html).toContain('title="script error: boom"');
  });

  it('an empty array renders the same quiet empty state, not an error', () => {
    const store = createValueStore({ xs: { value: [], status: 'fresh' } });
    const html = renderMarkToHtml(
      '::table{data=xs}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('mk-table--empty');
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
      renderMarkToHtml('::table{data=xs}\n', defaultHtmlRegistry, store),
    ).not.toThrow();
    const html = renderMarkToHtml(
      '::table{data=xs}\n',
      defaultHtmlRegistry,
      store,
    );
    expect(html).toContain('mk-table--empty');
  });

  it('a revoked proxy element inside an array degrades without throwing', () => {
    const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
    revoke();
    const store = createValueStore({ xs: { value: [proxy], status: 'fresh' } });
    expect(() =>
      renderMarkToHtml('::table{data=xs}\n', defaultHtmlRegistry, store),
    ).not.toThrow();
  });
});
