/**
 * Hand-written width measurement, padding, wrapping, and box-drawing for the
 * handful of STANDARD COMPONENTS that draw their own fixed-width glyphs
 * (`card`, `callout`, `divider`, `chart`, `table`, and the plain-markdown
 * table grid in `render.tsx`). Everything else in this engine wraps prose
 * through Ink's own layout (`ink-string.ts`'s doc comment and AGENTS.md's
 * batch-10 brief: "Drop wrap/pad/columns/frame/rule: Ink's layout replaces
 * them").
 *
 * A self-drawing component cannot lean on Ink for this: the string it builds
 * (a box-drawing frame, a sparkline, a table grid) is a fixed block of
 * characters that has to be CORRECT the moment it is built, because Ink's
 * `<Text>` renders it verbatim rather than reflowing pre-drawn glyphs. This
 * module is therefore kept as a small, PRIVATE (not exported from
 * `src/index.ts`) implementation detail of those few components, replacing
 * the old public `measure.ts`/`box.ts` modules the batch-10 brief has this
 * engine delete. The width-measurement approximation is unchanged from the
 * old `measure.ts`: Latin/CJK/emoji/combining-mark ranges, not a full
 * Unicode grapheme-segmentation table (see the doc comment below for the one
 * documented limitation).
 */

/** SGR: `ESC [ ... m`. */
const SGR_PATTERN = /\x1b\[[0-9;]*m/g;
/** OSC 8 hyperlink open/close: `ESC ] 8 ; ; ... BEL`. */
const OSC8_PATTERN = /\x1b\]8;;[^\x07\x1b]*\x07/g;
const ESCAPE_PATTERN = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*\x07/g;

/** Removes every SGR and OSC 8 escape sequence this engine can itself produce, so `measureWidth` counts only what a terminal actually draws. */
export function stripEscapes(text: string): string {
  return text.replace(OSC8_PATTERN, '').replace(SGR_PATTERN, '');
}

const COMBINING_RANGES: readonly [number, number][] = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20f0],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
];

const ZERO_WIDTH_RANGES: readonly [number, number][] = [
  [0x200b, 0x200d],
  [0x2060, 0x2060],
  [0xfeff, 0xfeff],
];

const WIDE_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

const EMOJI_RANGES: readonly [number, number][] = [
  [0x1f300, 0x1f64f],
  [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff],
  [0x1fa70, 0x1faff],
];

const EMOJI_PRESENTATION_LOW = 0x2600;
const EMOJI_PRESENTATION_HIGH = 0x27bf;
const VARIATION_SELECTOR_16 = 0xfe0f;

function inRanges(code: number, ranges: readonly [number, number][]): boolean {
  for (const [low, high] of ranges) {
    if (code >= low && code <= high) return true;
  }
  return false;
}

function codePointWidth(code: number, next: number | undefined): number {
  if (inRanges(code, COMBINING_RANGES)) return 0;
  if (inRanges(code, ZERO_WIDTH_RANGES)) return 0;
  if (inRanges(code, WIDE_RANGES)) return 2;
  if (inRanges(code, EMOJI_RANGES)) return 2;
  if (
    code >= EMOJI_PRESENTATION_LOW &&
    code <= EMOJI_PRESENTATION_HIGH &&
    next === VARIATION_SELECTOR_16
  ) {
    return 2;
  }
  return 1;
}

/**
 * The display width of `text`, ANSI escapes stripped first. This is a
 * deliberate approximation of UAX #11 (see `text-grid.ts`'s module comment
 * and the former `measure.ts`'s identical documented limitation: a
 * zero-width-joiner emoji sequence measures as the sum of its parts).
 */
export function measureWidth(text: string): number {
  const stripped = stripEscapes(text);
  const codePoints = Array.from(stripped, (char) => char.codePointAt(0) ?? 0);
  let width = 0;
  for (let index = 0; index < codePoints.length; index += 1) {
    width += codePointWidth(codePoints[index]!, codePoints[index + 1]);
  }
  return width;
}

interface Atom {
  text: string;
  width: number;
}

function pushChars(atoms: Atom[], plain: string): void {
  for (const char of plain)
    atoms.push({ text: char, width: measureWidth(char) });
}

function tokenize(text: string): Atom[] {
  const atoms: Atom[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  ESCAPE_PATTERN.lastIndex = 0;
  while ((match = ESCAPE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex)
      pushChars(atoms, text.slice(lastIndex, match.index));
    atoms.push({ text: match[0], width: 0 });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) pushChars(atoms, text.slice(lastIndex));
  return atoms;
}

function breakLongWord(word: string, width: number): string[] {
  const atoms = tokenize(word);
  const chunks: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const atom of atoms) {
    if (currentWidth + atom.width > width && current !== '') {
      chunks.push(current);
      current = '';
      currentWidth = 0;
    }
    current += atom.text;
    currentWidth += atom.width;
  }
  if (current !== '') chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}

/** Greedy word wrap to `width` columns, used only by a self-drawing component's own internal text (its title, its caption). Not exposed on `AnsiRenderContext`: ordinary prose wraps through Ink's own layout instead. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const lines: string[] = [];
  for (const hardLine of text.split('\n')) {
    const words = hardLine.split(/ +/).filter((word) => word !== '');
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    let currentWidth = 0;
    for (const word of words) {
      const wordWidth = measureWidth(word);
      if (wordWidth > w) {
        if (current !== '') {
          lines.push(current);
          current = '';
          currentWidth = 0;
        }
        lines.push(...breakLongWord(word, w));
        continue;
      }
      if (current === '') {
        current = word;
        currentWidth = wordWidth;
        continue;
      }
      if (currentWidth + 1 + wordWidth <= w) {
        current += ` ${word}`;
        currentWidth += 1 + wordWidth;
      } else {
        lines.push(current);
        current = word;
        currentWidth = wordWidth;
      }
    }
    if (current !== '') lines.push(current);
  }
  return lines;
}

/** Pads `text` to `width` columns with spaces, aligned `left`/`center`/`right`. */
export function padText(
  text: string,
  width: number,
  align: 'left' | 'center' | 'right',
): string {
  const total = Math.max(0, width - measureWidth(text));
  if (total === 0) return text;
  if (align === 'right') return ' '.repeat(total) + text;
  if (align === 'center') {
    const left = Math.floor(total / 2);
    const right = total - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
  return text + ' '.repeat(total);
}

/** `frameBlock`'s options: mirrors the old `box.ts`'s `FrameOptions`. */
export interface FrameOptions {
  style: 'solid' | 'dashed';
  title?: string;
  width: number;
}

/** Draws a box around `block`, one glyph set for `'solid'`, another for `'dashed'`, with an optional title woven into the top edge. */
export function frameBlock(block: string, options: FrameOptions): string {
  const { style: kind, title, width } = options;
  const horizontal = kind === 'dashed' ? '╌' : '─';
  const vertical = kind === 'dashed' ? '┆' : '│';
  const innerWidth = Math.max(1, width - 2);

  let top: string;
  if (title) {
    const label = ` ${title} `;
    const remaining = Math.max(0, innerWidth - measureWidth(label) - 1);
    top = `┌${horizontal}${label}${horizontal.repeat(remaining)}┐`;
  } else {
    top = `┌${horizontal.repeat(innerWidth)}┐`;
  }
  const bottom = `└${horizontal.repeat(innerWidth)}┘`;
  const lines = block
    .split('\n')
    .map(
      (line) => `${vertical}${padText(line, innerWidth, 'left')}${vertical}`,
    );
  return [top, ...lines, bottom].join('\n');
}

/** A full-width horizontal rule, `char` (default `─`) repeated to `width` columns. */
export function ruleLine(width: number, char = '─'): string {
  return char.repeat(Math.max(0, width));
}

/** Prefixes every line of `block` (split on `\n`) with `prefix`, e.g. a blockquote's `│ `. */
export function indentBlock(block: string, prefix: string): string {
  return block
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

/**
 * Places `blocks` side by side, each padded (left-aligned) to its entry in
 * `widths`, joined by `gutter` spaces, top-aligned. Used only by the plain
 * GFM markdown table (`render.tsx`'s `renderGfmTable`) and
 * `table-grid.ts`'s own row-drawing; `row`'s OWN columns are placed by a
 * real Ink flex `Box` instead (`components/row.tsx`), not by this helper.
 */
export function columnsBlock(
  blocks: readonly string[],
  widths: readonly number[],
  gutter: number,
): string {
  const gap = ' '.repeat(Math.max(0, gutter));
  const lineArrays = blocks.map((block) => block.split('\n'));
  const rowCount = Math.max(0, ...lineArrays.map((lines) => lines.length));
  const rows: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const cells = lineArrays.map((lines, index) =>
      padText(lines[row] ?? '', widths[index] ?? 0, 'left'),
    );
    rows.push(cells.join(gap).replace(/[ ]+$/, ''));
  }
  return rows.join('\n');
}
