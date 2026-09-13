import { columns } from '../box.js';
import type { AnsiComponent } from '../registry.js';

const COLS_VALUES = ['2', '3', '4'] as const;
type ColsValue = (typeof COLS_VALUES)[number];
function isColsValue(value: string): value is ColsValue {
  return (COLS_VALUES as readonly string[]).includes(value);
}

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
type TextAlign = (typeof TEXT_ALIGNS)[number];
function isTextAlign(value: string): value is TextAlign {
  return (TEXT_ALIGNS as readonly string[]).includes(value);
}

/** Below this width, cells stack vertically instead of sitting side by side — a named constant per the batch brief, not a magic number. */
export const ROW_COLUMN_THRESHOLD = 60;
/** Spaces between adjacent columns. */
const GUTTER = 1;

/**
 * `:::row{cols=2|3|4 text=left|center|right} ... :::` — docs/format.md's one
 * layout container. An absent/invalid `cols` auto-fits: every direct block
 * child becomes one column, all in a single row of columns. A `cols` value
 * smaller than the child count wraps into further grid rows, `cols` cells at
 * a time — the terminal counterpart of the CSS grid wrap a live host does.
 * Below `ROW_COLUMN_THRESHOLD` columns, or with only one cell, cells stack
 * vertically instead (a plain blank-line-separated list) — a fixed-width
 * terminal has no responsive reflow, so this is the one width breakpoint
 * that stands in for it.
 *
 * Each cell is one of the directive's own top-level children
 * (`registry.ts`'s `AnsiChildren.parts`: a `:::cell` directive grouping
 * several blocks, or any other block standing for itself, per docs/format.md's
 * "a row counts its direct block children as its cells"), rendered through
 * that part's own `render({ width })` at the ACTUAL column width decided
 * below, rather than rendered once at the row's full width and then
 * re-wrapped into a narrower column. A cell containing a self-drawing box
 * (a nested `card`/`table`) therefore draws that box at the real column
 * width in the first place, instead of having an already-drawn frame
 * mangled by a later re-wrap.
 */
export const Row: AnsiComponent = (attributes, children, ctx) => {
  const rawTextAlign = attributes.text;
  const align: TextAlign =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : 'left';

  const cellParts = children.parts;
  if (cellParts.length === 0) return '';

  const rawCols = attributes.cols ?? '';
  const requestedCols = isColsValue(rawCols)
    ? Number(rawCols)
    : cellParts.length;
  const columnCount = Math.max(1, Math.min(requestedCols, cellParts.length));

  const place = (text: string, width: number): string =>
    align === 'left'
      ? text
      : text
          .split('\n')
          .map((line) => ctx.pad(line, width, align))
          .join('\n');

  if (ctx.width < ROW_COLUMN_THRESHOLD || columnCount <= 1) {
    return cellParts
      .map((part) => place(part.render({ width: ctx.width }), ctx.width))
      .join('\n\n');
  }

  const colWidth = Math.max(
    1,
    Math.floor((ctx.width - GUTTER * (columnCount - 1)) / columnCount),
  );
  const placedCells = cellParts.map((part) =>
    place(part.render({ width: colWidth }), colWidth),
  );

  const gridRows: string[] = [];
  for (let index = 0; index < placedCells.length; index += columnCount) {
    const rowCells = placedCells.slice(index, index + columnCount);
    const widths = rowCells.map(() => colWidth);
    gridRows.push(columns(rowCells, widths, GUTTER));
  }
  return gridRows.join('\n\n');
};
