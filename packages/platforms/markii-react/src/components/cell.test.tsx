import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';
import { Cell } from './cell';

/** Direct element children of `row` — i.e. its actual grid cells. */
function cellsOf(row: Element | null): Element[] {
  return row ? Array.from(row.children) : [];
}

describe('Cell', () => {
  it('renders exactly one plain <div class="mk-cell"> and nothing else', () => {
    const { container } = render(<Cell attributes={{}}>x</Cell>);
    const el = container.firstElementChild;
    expect(el?.tagName).toBe('DIV');
    expect(el?.className).toBe('mk-cell');
    expect(container.children).toHaveLength(1);
    // transparent: the class is the ONLY attribute it carries
    expect(el?.getAttributeNames()).toEqual(['class']);
  });

  it('never reads attributes: an attribute-bearing invocation renders identically', () => {
    const { container: withAttrs } = render(
      <Cell attributes={{ foo: 'bar', cols: '3', data: 'x' }}>x</Cell>,
    );
    const { container: withoutAttrs } = render(<Cell attributes={{}}>x</Cell>);
    expect(withAttrs.innerHTML).toBe(withoutAttrs.innerHTML);
  });

  it('does not throw and renders an empty <div> when children are absent', () => {
    expect(() => render(<Cell attributes={{}} />)).not.toThrow();
    const { container } = render(<Cell attributes={{}} />);
    expect(container.firstElementChild?.tagName).toBe('DIV');
    expect(container.firstElementChild?.textContent).toBe('');
  });
});

describe('defaultRegistry — cell', () => {
  it('is registered as a block (non-inline) container', () => {
    expect(defaultRegistry.cell?.component).toBe(Cell);
    expect(defaultRegistry.cell?.inline).toBe(false);
  });
});

describe('renderMark — :::cell inside :::row', () => {
  it('groups several blocks into ONE row cell', () => {
    const { container } = render(
      renderMark(
        [
          '::::row',
          ':::cell',
          'first paragraph',
          '',
          'second paragraph',
          ':::',
          '::::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const cells = cellsOf(container.querySelector('.mk-row'));
    expect(cells).toHaveLength(1);
    expect(cells[0]?.className).toBe('mk-cell');
    expect(cells[0]?.querySelectorAll('p')).toHaveLength(2);
  });

  it('each direct child of row remaining one cell stays the default (no cell involved)', () => {
    const { container } = render(
      renderMark(
        ['::::row', 'first paragraph', '', 'second paragraph', '::::'].join(
          '\n',
        ),
        defaultRegistry,
      ),
    );
    const cells = cellsOf(container.querySelector('.mk-row'));
    expect(cells).toHaveLength(2);
    expect(cells.every((cell) => cell.tagName === 'P')).toBe(true);
  });

  /**
   * The motivating repro (TODO K4): markdown merges two adjacent lists into
   * ONE list, so two task lists can never be two row cells on their own —
   * they arrive as a single `<ul>`, i.e. a single cell. One `cell` around
   * each is the only way to separate them.
   */
  it('two task lists in a bare row merge into a single list, i.e. ONE cell', () => {
    const { container } = render(
      renderMark(
        [
          '::::row',
          '- [ ] a',
          '- [ ] b',
          '',
          '- [ ] c',
          '- [ ] d',
          '::::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const cells = cellsOf(container.querySelector('.mk-row'));
    expect(cells).toHaveLength(1);
    expect(cells[0]?.tagName).toBe('UL');
    expect(cells[0]?.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      4,
    );
  });

  it('two :::cells with one task list each are two separate cells', () => {
    const { container } = render(
      renderMark(
        [
          '::::row',
          ':::cell',
          '- [ ] a',
          '- [ ] b',
          ':::',
          '',
          ':::cell',
          '- [ ] c',
          '- [ ] d',
          ':::',
          '::::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const cells = cellsOf(container.querySelector('.mk-row'));
    expect(cells).toHaveLength(2);
    expect(cells.every((cell) => cell.className === 'mk-cell')).toBe(true);
    for (const cell of cells) {
      expect(cell.querySelectorAll('ul')).toHaveLength(1);
      expect(cell.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    }
  });

  it('keeps the row grid classes intact', () => {
    const { container } = render(
      renderMark(
        ['::::row{cols=2}', ':::cell', 'a', ':::', '::::'].join('\n'),
        defaultRegistry,
      ),
    );
    const row = container.querySelector('.mk-row');
    expect(row?.className).toBe('mk-row mk-row--cols-2');
  });
});

describe('renderMark — :::cell outside a row', () => {
  it('is a harmless transparent div that still renders its content', () => {
    const { container } = render(
      renderMark(':::cell\nplain **text**\n:::', defaultRegistry),
    );
    const cell = container.querySelector('.mk-cell');
    expect(cell?.tagName).toBe('DIV');
    expect(cell?.className).toBe('mk-cell');
    expect(cell?.querySelector('strong')?.textContent).toBe('text');
    // no fallback box, no row machinery leaking out of the row context
    expect(container.querySelector('.mk-unknown')).toBeNull();
    expect(container.querySelector('.mk-row')).toBeNull();
  });

  it('carries no visual attributes of its own (no style, no role, no data-*)', () => {
    const { container } = render(
      renderMark(':::cell\nx\n:::', defaultRegistry),
    );
    expect(container.querySelector('.mk-cell')?.getAttributeNames()).toEqual([
      'class',
    ]);
  });
});

describe('renderMark — :::cell nesting', () => {
  it('nests inside another cell without collapsing either', () => {
    const { container } = render(
      renderMark(
        ['::::cell', 'outer', ':::cell', 'inner', ':::', '::::'].join('\n'),
        defaultRegistry,
      ),
    );
    const outer = container.querySelector('.mk-cell');
    expect(outer?.className).toBe('mk-cell');
    const inner = outer?.querySelector('.mk-cell');
    expect(inner?.className).toBe('mk-cell');
    expect(inner?.textContent).toContain('inner');
  });

  it('holds a layout wrapper, and sits inside one, unchanged', () => {
    const { container } = render(
      renderMark(
        ['::::cell', ':::center', 'centered', ':::', '::::'].join('\n'),
        defaultRegistry,
      ),
    );
    const wrapper = container.querySelector('.mk-cell > .mk-layout');
    expect(wrapper?.className).toBe('mk-layout mk-align-center');

    const { container: inverted } = render(
      renderMark(
        ['::::center', ':::cell', 'x', ':::', '::::'].join('\n'),
        defaultRegistry,
      ),
    );
    expect(inverted.querySelector('.mk-layout > .mk-cell')).not.toBeNull();
  });
});

describe('renderMark — :::cell with hostile children', () => {
  it('never throws, and degrades each hostile child the ordinary way', () => {
    const source = [
      '::::cell',
      ':constructor[proto]',
      '',
      '::nope{foo=bar}',
      '',
      '[bad](javascript:alert(1))',
      '',
      '![x](javascript:alert(2))',
      '',
      '```lua {name=probe}',
      'return 1',
      '```',
      '::::',
    ].join('\n');

    expect(() => render(renderMark(source, defaultRegistry))).not.toThrow();
    const { container } = render(renderMark(source, defaultRegistry));

    const cell = container.querySelector('.mk-cell');
    expect(cell).not.toBeNull();
    // the prototype-named inline directive falls back inline, in-paragraph
    expect(cell?.querySelector('.mk-unknown--inline')).not.toBeNull();
    // the unknown leaf directive falls back as a block box
    expect(cell?.querySelector('.mk-unknown--block')).not.toBeNull();
    // unsafe URLs are stripped, elements kept (core's sanitizer)
    expect(cell?.querySelector('a')?.getAttribute('href')).toBeNull();
    expect(cell?.querySelector('img')?.getAttribute('src')).toBeNull();
    // a script fence is still folded to a marker, never executed
    expect(cell?.querySelector('.mk-script')).not.toBeNull();
  });

  it('does not let an empty body break the row', () => {
    const { container } = render(
      renderMark(
        ['::::row', ':::cell', ':::', '::::'].join('\n'),
        defaultRegistry,
      ),
    );
    const cells = cellsOf(container.querySelector('.mk-row'));
    expect(cells).toHaveLength(1);
    expect(cells[0]?.className).toBe('mk-cell');
    expect(cells[0]?.textContent).toBe('');
  });
});

describe('doc.css — cell carries no outer margin (Architecture rule 4)', () => {
  const css = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../doc.css'),
    'utf8',
  );

  it("styles only the rhythm between a cell's own children", () => {
    expect(css).toContain('.mk-cell > * + * {');
    // no rule on `.mk-cell` itself: no border, background, padding or margin
    expect(css).not.toMatch(/\.mk-cell\s*\{/);
  });
});
