import type { AnsiComponent, DirectiveAttributes } from '../registry.js';

const COLS_VALUES = ['2', '3', '4'] as const;
type ColsValue = (typeof COLS_VALUES)[number];
function isColsValue(value: string): value is ColsValue {
  return (COLS_VALUES as readonly string[]).includes(value);
}

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type RowTextAlign = (typeof TEXT_ALIGNS)[number];
function isTextAlign(value: string): value is RowTextAlign {
  return (TEXT_ALIGNS as readonly string[]).includes(value);
}

/** Below this width, cells stack vertically instead of sitting side by side — a named constant per the batch brief, not a magic number. */
export const ROW_COLUMN_THRESHOLD = 60;

export interface RowLayout {
  align: RowTextAlign;
  columnCount: number;
  colWidth: number;
  stacked: boolean;
}

/**
 * `:::row{cols=2|3|4 text=left|center|right} ... :::`'s pure layout
 * decision: how many columns, how wide each one is, and whether the row
 * stacks. `render.tsx`'s walk calls this directly (rather than `row`'s own
 * registered component) so it can build each cell's real Ink subtree at the
 * correct width BEFORE assembling the row's flex `Box` — see `render.tsx`'s
 * top comment and `registry.ts`'s doc comment on why this one directive is
 * handled at the walk level. Kept here, not in `render.tsx`, so
 * `components/contract-drift.test.ts`'s literal source scan of `row.tsx`
 * still finds the `attributes.cols`/`attributes.text` reads.
 *
 * An absent/invalid `cols` auto-fits: every cell becomes one column, all in
 * a single grid row. A `cols` value smaller than the cell count wraps into
 * further grid rows, `cols` cells at a time. Below `ROW_COLUMN_THRESHOLD`
 * columns, or with only one cell, cells stack vertically instead.
 */
export function resolveRowLayout(
  attributes: DirectiveAttributes,
  cellCount: number,
  width: number,
): RowLayout {
  const rawTextAlign = attributes.text;
  const align: RowTextAlign =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : 'left';

  const rawCols = attributes.cols ?? '';
  const requestedCols = isColsValue(rawCols) ? Number(rawCols) : cellCount;
  const columnCount = Math.max(
    1,
    Math.min(requestedCols, Math.max(1, cellCount)),
  );

  const gutter = 1;
  const stacked = width < ROW_COLUMN_THRESHOLD || columnCount <= 1;
  const colWidth = stacked
    ? width
    : Math.max(
        1,
        Math.floor((width - gutter * (columnCount - 1)) / columnCount),
      );

  return { align, columnCount, colWidth, stacked };
}

/**
 * `row`'s registered component: a passthrough. `render.tsx`'s walk builds
 * the row's REAL flex-`Box` grid (or, for a `row` reached through STRING
 * mode nested inside a self-drawing container, a flattened string) directly
 * and hands it down as `children`, so the registered component's own job is
 * just to return what it was given. Kept as a real registration (rather
 * than omitted) so alias resolution, the contract-drift coverage test, and
 * an unexpected direct invocation all still see a real `row` component.
 */
export const Row: AnsiComponent = ({ children }) => children;
