import { measure } from './measure.js';

/**
 * Hand-written, width-aware layout helpers: wrapping, padding, side-by-side
 * columns, and box drawing. Every measurement goes through `./measure.ts`,
 * so these helpers wrap and pad correctly around colored text, wide CJK
 * characters, and emoji, not just plain ASCII. None of these read the
 * theme; they take and return plain strings, leaving color entirely to
 * `./style.ts` and the caller.
 *
 * `wrap`'s word-splitting collapses runs of spaces to one, the ordinary
 * behavior of a text wrapper: exact inter-word spacing is not something a
 * terminal reflow is expected to preserve.
 */

const ESCAPE_PATTERN = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07\x1b]*\x07/g;

interface Atom {
  text: string;
  width: number;
}

/**
 * Splits `text` into atoms an escape sequence never gets split across: each
 * escape sequence is its own zero-width atom, and every other code point is
 * its own atom carrying `measure`'s width for that single code point. A
 * combining mark or variation selector that only reads as zero-width in
 * context with its BASE character (see `./measure.ts`'s module comment)
 * still measures correctly here, because it is itself in the zero-width/
 * combining ranges regardless of what precedes it; the one case this
 * under- or over-counts by a column is the dingbat-plus-variation-selector
 * pair (`☀️`), which needs to see both code points at once to know it
 * should measure 2 — an accepted instance of `./measure.ts`'s documented
 * approximation.
 */
function tokenize(text: string): Atom[] {
  const atoms: Atom[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  ESCAPE_PATTERN.lastIndex = 0;
  while ((match = ESCAPE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      pushChars(atoms, text.slice(lastIndex, match.index));
    }
    atoms.push({ text: match[0], width: 0 });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) pushChars(atoms, text.slice(lastIndex));
  return atoms;
}

function pushChars(atoms: Atom[], plain: string): void {
  for (const char of plain) {
    atoms.push({ text: char, width: measure(char) });
  }
}

/** Breaks one over-long word into chunks of at most `width` columns, never splitting an escape sequence. */
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

/**
 * Greedy word wrap to `width` columns. An existing `\n` is a hard break
 * (each hard-broken segment is wrapped independently); a word wider than
 * `width` on its own is broken at the width boundary via `breakLongWord`
 * rather than overflowing the line.
 */
export function wrap(text: string, width: number): string[] {
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
      const wordWidth = measure(word);
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

/** Pads `text` to `width` columns with spaces, aligned `left`/`center`/`right`. A `text` already at or over `width` is returned unchanged. */
export function pad(
  text: string,
  width: number,
  align: 'left' | 'center' | 'right',
): string {
  const total = Math.max(0, width - measure(text));
  if (total === 0) return text;
  if (align === 'right') return ' '.repeat(total) + text;
  if (align === 'center') {
    const left = Math.floor(total / 2);
    const right = total - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
  return text + ' '.repeat(total);
}

/**
 * Re-wraps a block of text that was already wrapped to a WIDER budget than
 * `width` (the shape a component's pre-rendered `childrenText` always
 * arrives in: `render.ts` wraps a directive's body to the full directive
 * width before the component ever runs, since a container component that
 * draws its own frame or indent — `card`, `callout`, `details`, `figure` —
 * only learns it needs a NARROWER inner budget once it starts drawing).
 * Every existing `\n` is a hard break, each hard-broken line re-wrapped
 * independently if it still overflows `width`; a line already inside the
 * budget passes through unchanged. Mirrors the same pattern `render.ts`'s
 * `unknownDirective` fallback already uses for its dashed frame.
 */
export function rewrapBlock(text: string, width: number): string {
  if (!text) return text;
  return text
    .split('\n')
    .flatMap((line) => wrap(line, width))
    .join('\n');
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
 * `widths`, joined by `gutter` spaces, top-aligned: a block with fewer
 * lines than its neighbors gets its missing rows filled with blank,
 * full-width padding rather than leaving a ragged gap.
 */
export function columns(
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
      pad(lines[row] ?? '', widths[index] ?? 0, 'left'),
    );
    // The padding on the LAST column is dropped again. It buys nothing: no
    // column follows it to be aligned against, and left in place it would
    // end every row with a run of spaces, which shows up as trailing
    // whitespace in a committed fixture and in anything that pipes this
    // output to a file. Padding between columns is what does the work.
    rows.push(cells.join(gap).replace(/[ ]+$/, ''));
  }
  return rows.join('\n');
}

/** `frame`'s options: which glyph set to draw with, an optional title woven into the top edge, and the frame's total outer width (borders included). */
export interface FrameOptions {
  style: 'solid' | 'dashed';
  title?: string;
  width: number;
}

/**
 * Draws a box around `block`: `┌ ─ ┐ │ └ ┘` for `'solid'`, `┌ ╌ ┐ ┆ └ ┘` for
 * `'dashed'` (the corners are shared; only the edge glyphs change). A
 * `title` is woven into the top edge as `┌─ title ────┐`. Every content
 * line is padded to the frame's inner width, so every drawn line is exactly
 * `options.width` columns wide.
 */
export function frame(block: string, options: FrameOptions): string {
  const { style: kind, title, width } = options;
  const horizontal = kind === 'dashed' ? '╌' : '─';
  const vertical = kind === 'dashed' ? '┆' : '│';
  const innerWidth = Math.max(1, width - 2);

  let top: string;
  if (title) {
    const label = ` ${title} `;
    const remaining = Math.max(0, innerWidth - measure(label) - 1);
    top = `┌${horizontal}${label}${horizontal.repeat(remaining)}┐`;
  } else {
    top = `┌${horizontal.repeat(innerWidth)}┐`;
  }
  const bottom = `└${horizontal.repeat(innerWidth)}┘`;
  const lines = block
    .split('\n')
    .map((line) => `${vertical}${pad(line, innerWidth, 'left')}${vertical}`);
  return [top, ...lines, bottom].join('\n');
}

/** A full-width horizontal rule, `char` (default `─`) repeated to `width` columns. */
export function rule(width: number, char = '─'): string {
  return char.repeat(Math.max(0, width));
}
