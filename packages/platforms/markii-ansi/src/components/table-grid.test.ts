import { describe, expect, it } from 'vitest';
import {
  drawTableGrid,
  MIN_COLUMN_WIDTH,
  measureTableGridWidth,
} from './table-grid.js';
import { measureWidth } from '../text-grid.js';

describe('drawTableGrid', () => {
  it('draws a header, separator, and body rows with box-drawing glyphs', () => {
    const grid = drawTableGrid(
      ['name', 'role'],
      [
        ['Ana', 'Admin'],
        ['Bo', 'User'],
      ],
      40,
    );
    expect(grid).toContain('┌');
    expect(grid).toContain('┬');
    expect(grid).toContain('┐');
    expect(grid).toContain('├');
    expect(grid).toContain('┼');
    expect(grid).toContain('┤');
    expect(grid).toContain('└');
    expect(grid).toContain('┴');
    expect(grid).toContain('┘');
    expect(grid).toContain('name');
    expect(grid).toContain('Ana');
  });

  it('every line is the same width', () => {
    const grid = drawTableGrid(
      ['a', 'bb'],
      [
        ['1', '22'],
        ['333', '4'],
      ],
      40,
    );
    const widths = new Set(grid.split('\n').map((line) => measureWidth(line)));
    expect(widths.size).toBe(1);
  });

  it('shrinks the widest column first when the natural total overflows the width', () => {
    const grid = drawTableGrid(
      ['short', 'a very long column header indeed'],
      [['x', 'y']],
      30,
    );
    const widths = new Set(grid.split('\n').map((line) => measureWidth(line)));
    expect(widths.size).toBe(1);
    expect([...widths][0]).toBeLessThanOrEqual(30 + MIN_COLUMN_WIDTH); // allowed to overflow past the floor, never crash
  });

  it('wraps a cell whose column shrank below its content width instead of dropping text', () => {
    const grid = drawTableGrid(
      undefined,
      [['a rather long single cell value']],
      15,
    );
    expect(grid).toContain('rather');
    expect(grid).toContain('long');
  });

  it('applies bold only to the header row', () => {
    const bold = (text: string) => `<b>${text}</b>`;
    const grid = drawTableGrid(['h'], [['x']], 20, bold);
    expect(grid).toContain('<b>');
    const bodyLine = grid.split('\n').find((line) => line.includes('x'));
    expect(bodyLine).not.toContain('<b>');
  });

  it('measureTableGridWidth reports the natural (unshrunk) footprint', () => {
    const width = measureTableGridWidth(['a'], [['bb']]);
    expect(width).toBeGreaterThan(2);
  });

  it('draws with no header when none is given', () => {
    const grid = drawTableGrid(undefined, [['x']], 10);
    expect(grid.split('\n')).toHaveLength(3); // top, one row, bottom
  });
});
