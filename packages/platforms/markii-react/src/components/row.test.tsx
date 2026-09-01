import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';
import { Row } from './row';

describe('Row', () => {
  it.each(['2', '3', '4'])(
    'renders mk-row plus mk-row--cols-%s for an exact match',
    (cols) => {
      const { container } = render(<Row attributes={{ cols }}>x</Row>);
      const row = container.firstElementChild;
      expect(row).toHaveClass('mk-row');
      expect(row).toHaveClass(`mk-row--cols-${cols}`);
    },
  );

  it.each([
    ['99', 'out of range'],
    ['-1', 'negative'],
    ['abc', 'non-numeric'],
    ['2.0', 'not an exact integer string'],
    [' 2', 'leading whitespace'],
  ])(
    'degrades to plain mk-row (auto-fit) for an invalid cols value (%s: %s)',
    (cols) => {
      const { container } = render(<Row attributes={{ cols }}>x</Row>);
      const row = container.firstElementChild;
      expect(row).toHaveClass('mk-row');
      expect(row?.className).toBe('mk-row');
    },
  );

  it('degrades to plain mk-row (auto-fit) when cols is absent', () => {
    const { container } = render(<Row attributes={{}}>x</Row>);
    const row = container.firstElementChild;
    expect(row?.className).toBe('mk-row');
  });

  it('degrades to plain mk-row when cols is a bare (null) attribute', () => {
    const { container } = render(<Row attributes={{ cols: null }}>x</Row>);
    const row = container.firstElementChild;
    expect(row?.className).toBe('mk-row');
  });

  it('renders its children as-is (no per-cell wrapping)', () => {
    const { getByText } = render(
      <Row attributes={{}}>
        <div>cell content</div>
      </Row>,
    );
    expect(getByText('cell content')).toBeInTheDocument();
  });
});

describe('renderMark — :::row{cols=...} container directive', () => {
  it('renders a row with three stat cells given cols=3', () => {
    const { container } = render(
      renderMark(
        [
          ':::row{cols=3}',
          '::stat{value=1 label="a"}',
          '',
          '::stat{value=2 label="b"}',
          '',
          '::stat{value=3 label="c"}',
          ':::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const row = container.querySelector('.mk-row.mk-row--cols-3');
    expect(row).not.toBeNull();
    expect(row?.querySelectorAll('.mk-stat')).toHaveLength(3);
  });

  it('degrades to auto-fit for an invalid cols value on a real directive', () => {
    const { container } = render(
      renderMark(':::row{cols=7}\n::stat{value=1}\n:::', defaultRegistry),
    );
    const row = container.querySelector('.mk-row');
    expect(row).not.toBeNull();
    expect(row?.className).toBe('mk-row');
  });

  it('degrades to auto-fit when cols is absent on a real directive', () => {
    const { container } = render(
      renderMark(':::row\n::stat{value=1}\n:::', defaultRegistry),
    );
    const row = container.querySelector('.mk-row');
    expect(row).not.toBeNull();
    expect(row?.className).toBe('mk-row');
  });
});

describe('renderMark — :::row{text=...} cascades into cells', () => {
  it.each(['left', 'center', 'right'])(
    'text=%s puts the matching mk-text-* class on the row itself, with no extra wrapper',
    (text) => {
      const { container } = render(
        renderMark(
          `:::row{cols=2 text=${text}}\ncell one\n\ncell two\n:::`,
          defaultRegistry,
        ),
      );
      const row = container.firstElementChild;
      expect(row?.className).toBe(`mk-row mk-row--cols-2 mk-text-${text}`);
      expect(container.children).toHaveLength(1);
    },
  );

  it('an invalid text value degrades silently to a plain row', () => {
    const { container } = render(
      renderMark(
        ':::row{cols=2 text=diagonal}\ncell one\n\ncell two\n:::',
        defaultRegistry,
      ),
    );
    expect(container.firstElementChild?.className).toBe(
      'mk-row mk-row--cols-2',
    );
  });

  it('text never reaches the DOM as an attribute', () => {
    const { container } = render(
      renderMark(':::row{text=center}\ncell one\n:::', defaultRegistry),
    );
    expect(container.firstElementChild?.getAttribute('text')).toBeNull();
  });

  it('a cell with its own text overrides the row cascade', () => {
    const { container } = render(
      renderMark(
        [
          '::::row{cols=2 text=center}',
          ':::cell{text=left}',
          'opted-out cell',
          ':::',
          '',
          ':::cell',
          'inheriting cell',
          ':::',
          '::::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const row = container.querySelector('.mk-row.mk-text-center');
    expect(row).not.toBeNull();
    const overriding = row?.querySelector('.mk-cell.mk-text-left');
    expect(overriding).not.toBeNull();
    expect(overriding?.textContent).toContain('opted-out cell');
    // the inheriting cell carries no text class of its own: the row's value
    // reaches it through ordinary CSS inheritance, not a copied class
    const cells = row?.querySelectorAll('.mk-cell') ?? [];
    const inheriting = [...cells].find((cell) =>
      cell.textContent?.includes('inheriting cell'),
    );
    expect(inheriting?.className).toBe('mk-cell');
  });

  it('a more local :::left wrapper inside a cell overrides the row-level text=center (locality wins)', () => {
    const { container } = render(
      renderMark(
        [
          '::::row{cols=2 text=center}',
          ':::left',
          'opted-out cell',
          ':::',
          '',
          'default cell',
          '::::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const row = container.querySelector('.mk-row.mk-text-center');
    expect(row).not.toBeNull();
    const localOverride = row?.querySelector('.mk-layout.mk-align-left');
    expect(localOverride).not.toBeNull();
    expect(localOverride?.textContent).toContain('opted-out cell');
    // the local wrapper is a descendant of the row, not a sibling — this is
    // what lets plain text-align inheritance, rather than any CSS-specificity
    // trick, decide the winner
    expect(row?.contains(localOverride as Node)).toBe(true);
  });

  it('align on a row keeps its ordinary meaning: the generic wrapper div, no content alignment', () => {
    const { container } = render(
      renderMark(
        ':::row{cols=2 align=center}\ncell one\n\ncell two\n:::',
        defaultRegistry,
      ),
    );
    const outer = container.firstElementChild;
    expect(outer?.className).toBe('mk-align-center');
    const row = outer?.querySelector('.mk-row.mk-row--cols-2');
    expect(row).not.toBeNull();
    // the row itself gets no text class — `align` no longer means "align the
    // content inside the cells"; that job belongs to `text`
    expect(row?.className).toBe('mk-row mk-row--cols-2');
  });
});

describe('doc.css — text alignment is one class set, honored by the four text components', () => {
  const css = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../doc.css'),
    'utf8',
  );

  it('defines one rule per text value', () => {
    expect(css).toContain('.mk-text-left {');
    expect(css).toContain('.mk-text-center {');
    expect(css).toContain('.mk-text-right {');
  });

  it('no longer overloads align on a row to mean content alignment', () => {
    expect(css).not.toContain('.mk-align-left > .mk-row');
    expect(css).not.toContain('.mk-align-center > .mk-row');
    expect(css).not.toContain('.mk-align-right > .mk-row');
  });

  it('gives :::left its own declared text-align, so it can undo an inherited one', () => {
    // Only a DECLARED value beats an inherited one, and `:::left` exists
    // specifically to opt a cell back out of `:::row{text=center}`.
    expect(css).toContain('.mk-layout.mk-align-left {');
  });
});
