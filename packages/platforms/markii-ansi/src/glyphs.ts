/**
 * Every glyph this engine draws on its own, as one table per box style.
 * `unicode` is the default; `ascii` is a 7-bit form for a terminal that
 * cannot show box drawing or symbols. Every component, frame, rule, and
 * status-line string reads its glyphs from the set the render was given,
 * so the two styles cannot drift apart: `glyphs.test.ts` renders the whole
 * render corpus in `ascii` and fails on any byte above 0x7f that did not
 * come from the note itself.
 *
 * Each entry occupies the same number of terminal columns in both sets
 * where layout depends on it (frames, rules, bars, focus and fold markers),
 * so switching style never changes how a note wraps. The engine never
 * picks a style from the environment; the host decides.
 */

export const BOX_STYLES = ['unicode', 'ascii'] as const;
export type BoxStyle = (typeof BOX_STYLES)[number];

export function isBoxStyle(value: string): value is BoxStyle {
  return (BOX_STYLES as readonly string[]).includes(value);
}

/** One frame edge set: the solid frame of a card, or the dashed one of a fallback box. */
export interface FrameEdges {
  readonly horizontal: string;
  readonly vertical: string;
}

export interface GlyphSet {
  /** Corners shared by every frame and by a table's outer edge. */
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly solid: FrameEdges;
  readonly dashed: FrameEdges;
  /** A table's inner junctions. */
  readonly teeDown: string;
  readonly teeUp: string;
  readonly teeRight: string;
  readonly teeLeft: string;
  readonly cross: string;
  /** A thematic break and a `divider` drawn as a line. */
  readonly rule: string;
  /** A `divider` drawn as dots. */
  readonly ruleDots: string;
  /** A `divider{style=ornament}` centerpiece. */
  readonly ornament: string;
  /** The bar a blockquote's lines start with, including its trailing space. */
  readonly quoteBar: string;
  /** The bar a callout's lines start with, including its trailing space. */
  readonly calloutBar: string;
  readonly calloutIcons: {
    readonly info: string;
    readonly warning: string;
    readonly danger: string;
  };
  /** The marker before a focused block's heading, including its trailing space. */
  readonly focus: string;
  /** A details block's fold marker. */
  readonly foldOpen: string;
  readonly foldClosed: string;
  /** The collapsed script marker: its leading symbol and the separator before its detail. */
  readonly script: string;
  readonly scriptSeparator: string;
  /** Eight steps, lowest first, that a line chart's sparkline is built from. */
  readonly sparkline: string;
  /** A filled bar cell (chart bars, a progress bar's done part) and an empty one. */
  readonly barFilled: string;
  readonly barEmpty: string;
  readonly starFilled: string;
  readonly starEmpty: string;
  /** What a `stat` shows when its value is empty. */
  readonly emptyValue: string;
  /** The key legend on the live viewer's status line. */
  readonly keyLegend: string;
}

const UNICODE: GlyphSet = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  solid: { horizontal: '─', vertical: '│' },
  dashed: { horizontal: '╌', vertical: '┆' },
  teeDown: '┬',
  teeUp: '┴',
  teeRight: '├',
  teeLeft: '┤',
  cross: '┼',
  rule: '─',
  ruleDots: '·',
  ornament: '❖',
  quoteBar: '│ ',
  calloutBar: '▌ ',
  calloutIcons: { info: 'ℹ', warning: '▲', danger: '✕' },
  focus: '› ',
  foldOpen: '▾',
  foldClosed: '▸',
  script: '⚙',
  scriptSeparator: '·',
  sparkline: '▁▂▃▄▅▆▇█',
  barFilled: '█',
  barEmpty: '░',
  starFilled: '★',
  starEmpty: '☆',
  emptyValue: '—',
  keyLegend:
    'q quit  ↑↓/jk focus  ←→/tab switch  enter open/close  space/pgdn scroll  g/G top/end',
};

const ASCII: GlyphSet = {
  topLeft: '+',
  topRight: '+',
  bottomLeft: '+',
  bottomRight: '+',
  solid: { horizontal: '-', vertical: '|' },
  dashed: { horizontal: '.', vertical: ':' },
  teeDown: '+',
  teeUp: '+',
  teeRight: '+',
  teeLeft: '+',
  cross: '+',
  rule: '-',
  ruleDots: '.',
  ornament: '*',
  quoteBar: '| ',
  calloutBar: '| ',
  calloutIcons: { info: 'i', warning: '!', danger: 'x' },
  focus: '> ',
  foldOpen: '-',
  foldClosed: '+',
  script: '#',
  scriptSeparator: '-',
  sparkline: '_.-:=+*#',
  barFilled: '#',
  barEmpty: '.',
  starFilled: '*',
  starEmpty: '.',
  emptyValue: '-',
  keyLegend:
    'q quit  up/down/jk focus  left/right/tab switch  enter open/close  space/pgdn scroll  g/G top/end',
};

const GLYPHS: Readonly<Record<BoxStyle, GlyphSet>> = {
  unicode: UNICODE,
  ascii: ASCII,
};

/** The glyph set for `style`; anything other than `'ascii'` gets the unicode set. */
export function glyphsFor(style: BoxStyle | undefined): GlyphSet {
  return style === 'ascii' ? GLYPHS.ascii : GLYPHS.unicode;
}
