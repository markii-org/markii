import { columns, rewrapBlock } from '../box.js';
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
 * FAITHFULNESS LIMITATION: each cell's block arrives ALREADY wrapped to the
 * row's full width (see `cell.ts`'s doc comment on why this engine hands a
 * container its children pre-rendered). This component re-wraps each cell's
 * lines to its narrower column width (`../box.ts`'s `rewrapBlock`) before
 * placing it, which reflows ordinary paragraph text correctly; a cell
 * containing something that draws its own box (a nested `card`/`table`)
 * would not re-wrap cleanly at a narrower width, the same accepted
 * limitation `applyLayout` documents for a `selfLayout` component.
 */
export const Row: AnsiComponent = (attributes, childrenText, ctx) => {
  const rawTextAlign = attributes.text;
  const align: TextAlign =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : 'left';

  const cellBlocks = childrenText ? childrenText.split('\n\n') : [];
  if (cellBlocks.length === 0) return '';

  const rawCols = attributes.cols ?? '';
  const requestedCols = isColsValue(rawCols)
    ? Number(rawCols)
    : cellBlocks.length;
  const columnCount = Math.max(1, Math.min(requestedCols, cellBlocks.length));

  const place = (text: string, width: number): string =>
    align === 'left'
      ? text
      : text
          .split('\n')
          .map((line) => ctx.pad(line, width, align))
          .join('\n');

  if (ctx.width < ROW_COLUMN_THRESHOLD || columnCount <= 1) {
    return cellBlocks.map((block) => place(block, ctx.width)).join('\n\n');
  }

  const colWidth = Math.max(
    1,
    Math.floor((ctx.width - GUTTER * (columnCount - 1)) / columnCount),
  );
  const placedCells = cellBlocks.map((block) =>
    place(rewrapBlock(block, colWidth), colWidth),
  );

  const gridRows: string[] = [];
  for (let index = 0; index < placedCells.length; index += columnCount) {
    const rowCells = placedCells.slice(index, index + columnCount);
    const widths = rowCells.map(() => colWidth);
    gridRows.push(columns(rowCells, widths, GUTTER));
  }
  return gridRows.join('\n\n');
};
