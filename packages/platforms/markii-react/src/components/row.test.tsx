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
