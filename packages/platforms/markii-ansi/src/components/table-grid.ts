import {
  padText as pad,
  wrapText as wrap,
  measureWidth as measure,
} from '../text-grid.js';

/**
 * The ONE box-drawing/width-negotiation routine every table this engine
 * draws goes through: the data-bound `::table` component (`./table.ts`) and
 * `render.ts`'s plain GFM markdown table both call `drawTableGrid`, so there
 * is exactly one place that decides how a table's columns share the
 * available width and exactly one set of box-drawing glyphs in the whole
 * engine (`┌ ┬ ┐ ├ ┼ ┤ └ ┴ ┘ ─ │`).
 *
 * Column-width negotiation: every cell (header included) is measured at its
 * natural width; if the natural total fits `width`, every column gets its
 * natural width. Otherwise the widest column is shrunk one column at a time
 * (ties broken by the leftmost widest column) until the total fits or every
 * column has hit `MIN_COLUMN_WIDTH`, whichever comes first — a table wider
 * than `width` even at every column's minimum is allowed to overflow rather
 * than produce unreadably thin columns; nothing in this engine truncates
 * text outright. A column narrower than its content wraps that cell's text
 * inside its own box (`./box.ts`'s `wrap`), so a row's height grows to fit
 * its tallest cell rather than losing text.
 */

/** The floor a column is shrunk to before a table is allowed to overflow `width`. Chosen so a wrapped cell still reads as more than one letter per line. */
export const MIN_COLUMN_WIDTH = 3;

/** Per-column border/padding overhead: one leading space, one trailing space, shared with `measureOverhead` below. */
const CELL_PADDING = 2;

function measureOverhead(columnCount: number): number {
  // One vertical border before each column plus one closing border, plus
  // one space of padding on each side of every column's content.
  return columnCount + 1 + columnCount * CELL_PADDING;
}

function naturalColumnWidths(
  header: readonly string[] | undefined,
  rows: readonly (readonly string[])[],
  columnCount: number,
): number[] {
  const widths: number[] = new Array<number>(columnCount).fill(1);
  const consider = (cells: readonly string[] | undefined) => {
    for (let c = 0; c < columnCount; c += 1) {
      const width = measure(cells?.[c] ?? '');
      if (width > widths[c]!) widths[c] = width;
    }
  };
  consider(header);
  for (const row of rows) consider(row);
  return widths;
}

/**
 * Shrinks `widths` (in place, returning a new array) until their total plus
 * `overhead` fits `budget`, or every column is at `MIN_COLUMN_WIDTH`. Each
 * step removes one column from the widest-remaining pool, so several
 * over-wide columns shrink roughly evenly rather than one column absorbing
 * the whole deficit.
 */
function negotiateColumnWidths(
  natural: readonly number[],
  width: number,
): number[] {
  const widths = [...natural];
  const columnCount = widths.length;
  const overhead = measureOverhead(columnCount);
  const budget = Math.max(columnCount * MIN_COLUMN_WIDTH, width - overhead);

  let total = widths.reduce((sum, w) => sum + w, 0);
  while (total > budget) {
    let widest = -1;
    for (let c = 0; c < columnCount; c += 1) {
      if (
        widths[c]! > MIN_COLUMN_WIDTH &&
        (widest === -1 || widths[c]! > widths[widest]!)
      ) {
        widest = c;
      }
    }
    if (widest === -1) break; // every column is already at the floor
    widths[widest] = widths[widest]! - 1;
    total -= 1;
  }
  return widths;
}

/** Wraps every cell in `row` to its column's width, returning the row's cells as line arrays and the row's resulting height. */
function wrapRow(
  row: readonly string[],
  widths: readonly number[],
): { lines: string[][]; height: number } {
  const lines = widths.map((w, c) => wrap(row[c] ?? '', w));
  const height = Math.max(1, ...lines.map((l) => l.length));
  return { lines, height };
}

function drawRow(
  row: readonly string[],
  widths: readonly number[],
  boldRow: boolean,
  boldFn: (text: string) => string,
  align: 'left' | 'center' | 'right',
): string {
  const { lines, height } = wrapRow(row, widths);
  const rowLines: string[] = [];
  for (let line = 0; line < height; line += 1) {
    const cells = widths.map((w, c) => {
      const text = pad(lines[c]?.[line] ?? '', w, align);
      return boldRow ? boldFn(text) : text;
    });
    rowLines.push(`│ ${cells.join(' │ ')} │`);
  }
  return rowLines.join('\n');
}

function drawSeparator(
  widths: readonly number[],
  left: string,
  mid: string,
  right: string,
): string {
  return `${left}${widths.map((w) => '─'.repeat(w + CELL_PADDING)).join(mid)}${right}`;
}

/**
 * Draws a box-drawn table. `header`, when given, is the bold first row,
 * separated from the body by its own rule; `rows` is every remaining row.
 * Every string is display text ALREADY sanitized/formatted by the caller
 * (this module escapes nothing of its own — there is no HTML/ANSI injection
 * risk in a plain string, only in the escape SEQUENCES `boldFn` itself
 * generates, which this module never constructs by hand). Returns a
 * complete grid at most `width` columns wide when the natural content
 * allows it, otherwise as narrow as `MIN_COLUMN_WIDTH` per column permits.
 */
export function drawTableGrid(
  header: readonly string[] | undefined,
  rows: readonly (readonly string[])[],
  width: number,
  boldFn: (text: string) => string = (text) => text,
  align: 'left' | 'center' | 'right' = 'left',
): string {
  const columnCount = Math.max(
    header?.length ?? 0,
    ...rows.map((row) => row.length),
    1,
  );
  const natural = naturalColumnWidths(header, rows, columnCount);
  const widths = negotiateColumnWidths(natural, width);

  const lines: string[] = [];
  lines.push(drawSeparator(widths, '┌', '┬', '┐'));
  if (header) {
    lines.push(drawRow(header, widths, true, boldFn, align));
    lines.push(drawSeparator(widths, '├', '┼', '┤'));
  }
  for (const row of rows)
    lines.push(drawRow(row, widths, false, boldFn, align));
  lines.push(drawSeparator(widths, '└', '┴', '┘'));
  return lines.join('\n');
}

/** The widest a `drawTableGrid` result's lines get, for a `selfLayout` component (`./table.ts`) that needs to know its own natural footprint (the `fit` width preset). */
export function measureTableGridWidth(
  header: readonly string[] | undefined,
  rows: readonly (readonly string[])[],
): number {
  const columnCount = Math.max(
    header?.length ?? 0,
    ...rows.map((row) => row.length),
    1,
  );
  const natural = naturalColumnWidths(header, rows, columnCount);
  return natural.reduce((sum, w) => sum + w, 0) + measureOverhead(columnCount);
}
