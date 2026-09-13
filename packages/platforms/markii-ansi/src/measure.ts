/**
 * Hand-written display-width measurement (no dependency is permitted here;
 * see AGENTS.md's Stack section and the batch brief). This is a DELIBERATE
 * APPROXIMATION of Unicode's East Asian Width property (UAX #11), not a
 * full Unicode width table: it covers the ranges most terminal content
 * actually uses (Latin text, CJK, common emoji, combining marks) and gets
 * one class of case knowingly wrong, documented below.
 *
 * KNOWN LIMITATION: a grapheme cluster joined by a zero-width joiner
 * (U+200D), such as a multi-person or multi-skin-tone emoji sequence,
 * measures as the sum of its parts rather than as the single glyph a
 * terminal actually draws. Getting this exactly right needs a real
 * grapheme-segmentation table, which this package deliberately does not
 * carry.
 */

/** SGR: `ESC [ ... m`. */
const SGR_PATTERN = /\x1b\[[0-9;]*m/g;
/** OSC 8 hyperlink open/close: `ESC ] 8 ; ; ... BEL`. */
const OSC8_PATTERN = /\x1b\]8;;[^\x07\x1b]*\x07/g;

/** Removes every SGR and OSC 8 escape sequence this engine can itself produce, so `measure` counts only what a terminal actually draws. */
export function stripAnsi(text: string): string {
  return text.replace(OSC8_PATTERN, '').replace(SGR_PATTERN, '');
}

/** Combining marks: measure 0, since a terminal draws them layered onto the preceding column rather than advancing the cursor. */
const COMBINING_RANGES: readonly [number, number][] = [
  [0x0300, 0x036f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x20d0, 0x20f0],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
];

/** Zero-width characters: measure 0 (zero-width space/joiner/non-joiner, word joiner, byte-order mark used as a zero-width no-break space). */
const ZERO_WIDTH_RANGES: readonly [number, number][] = [
  [0x200b, 0x200d],
  [0x2060, 0x2060],
  [0xfeff, 0xfeff],
];

/** East Asian Wide and Fullwidth: measure 2. */
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

/** Common emoji ranges: measure 2. U+2600-U+27BF is included only when followed by the U+FE0F variation selector (see `measureText`). */
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

/**
 * The display width of one code point, given the NEXT code point in the
 * stream (needed only to check the emoji-variation-selector rule for the
 * dingbat range U+2600-U+27BF).
 */
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
 * The display width of `text`: ANSI escapes are stripped first, then every
 * remaining code point (iterated as a code point, not a UTF-16 code unit,
 * so a surrogate pair counts once) contributes its width per
 * `codePointWidth`'s rules. This is what every wrapping/padding/column
 * helper in `./box.ts` measures against.
 */
export function measure(text: string): number {
  const stripped = stripAnsi(text);
  const codePoints = Array.from(stripped, (char) => char.codePointAt(0) ?? 0);
  let width = 0;
  for (let index = 0; index < codePoints.length; index += 1) {
    width += codePointWidth(codePoints[index]!, codePoints[index + 1]);
  }
  return width;
}
