import { describe, expect, it } from 'vitest';
import { createValueStore } from '@markii/runtime';
import { renderMarkToAnsi } from '../render.js';
import { stripEscapes } from '../text-grid.js';

describe('Table', () => {
  it('draws a box-drawn grid from an array of objects, header bold', async () => {
    const store = createValueStore({
      users: {
        value: [
          { name: 'Ana', role: 'Admin' },
          { name: 'Bo', role: 'User' },
        ],
        status: 'fresh',
      },
    });
    const out = await renderMarkToAnsi(
      '::table{data=users}\n',
      undefined,
      store,
    );
    expect(out).toContain('┌');
    expect(out).toContain('┬');
    expect(out).toContain('name');
    expect(out).toContain('Ana');
    expect(out).toContain('└');
  });

  it('columns= reorders/restricts columns', async () => {
    const store = createValueStore({
      users: {
        value: [{ name: 'Ana', role: 'Admin', extra: 'x' }],
        status: 'fresh',
      },
    });
    const out = stripEscapes(
      await renderMarkToAnsi(
        '::table{data=users columns="role,name"}\n',
        undefined,
        store,
      ),
    );
    expect(out.indexOf('role')).toBeLessThan(out.indexOf('name'));
    expect(out).not.toContain('extra');
  });

  it('limit= caps the number of rows shown', async () => {
    const store = createValueStore({
      xs: { value: [1, 2, 3, 4], status: 'fresh' },
    });
    const out = stripEscapes(
      await renderMarkToAnsi('::table{data=xs limit=2}\n', undefined, store),
    );
    expect(out).toContain('1');
    expect(out).toContain('2');
    expect(out).not.toContain('3');
    expect(out).not.toContain('4');
  });

  it('renders a neutral "no data" line for missing/empty binding', async () => {
    const out = stripEscapes(await renderMarkToAnsi('::table\n'));
    expect(out).toContain('no data');
  });

  it('a stale binding appends the quiet stale suffix', async () => {
    const store = createValueStore({ xs: { value: [1, 2], status: 'stale' } });
    const out = await renderMarkToAnsi('::table{data=xs}\n', undefined, store);
    expect(out).toContain('(stale)');
  });

  it('caption renders as a bold line above the grid', async () => {
    const store = createValueStore({ xs: { value: [1], status: 'fresh' } });
    const out = await renderMarkToAnsi(
      '::table{data=xs caption="My table"}\n',
      undefined,
      store,
    );
    expect(out).toContain('My table');
  });

  it('format/decimals apply to numeric cells only', async () => {
    const store = createValueStore({
      rows: { value: [{ n: 1234, s: 'text' }], status: 'fresh' },
    });
    const out = stripEscapes(
      await renderMarkToAnsi(
        '::table{data=rows format=compact}\n',
        undefined,
        store,
      ),
    );
    expect(out.toLowerCase()).toContain('k');
    expect(out).toContain('text');
  });
});
