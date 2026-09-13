import type { AnsiColor } from './ansi.js';

/**
 * The terminal engine's theme: one entry per Tier 1 token `doc.css`
 * declares (`packages/platforms/markii-react/src/doc.css`'s `.doc` block,
 * the one that sets `--mk-bg`). Today that is the ten neutrals, the five
 * semantic hues, and the four width presets — nineteen tokens in total.
 *
 * `theme-coverage.test.ts` parses that block the same way
 * `apps/obsidian/src/theme-coverage.test.ts` parses it for the Obsidian
 * theme layer, and fails whenever a Tier 1 token gets added to `doc.css`
 * without a matching entry here: the same drift alarm every host theme
 * layer carries (AGENTS.md's "New Tier 1 token" maintenance rule), applied
 * to a THIRD kind of consumer (a color model, not a stylesheet).
 */
export type Tier1Token =
  | '--mk-bg'
  | '--mk-raised'
  | '--mk-fg'
  | '--mk-surface'
  | '--mk-surface-strong'
  | '--mk-border'
  | '--mk-muted'
  | '--mk-faint'
  | '--mk-accent'
  | '--mk-on-accent'
  | '--mk-info'
  | '--mk-success'
  | '--mk-warning'
  | '--mk-danger'
  | '--mk-limit'
  | '--mk-width-fit'
  | '--mk-width-narrow'
  | '--mk-width-wide'
  | '--mk-width-full';

/**
 * A token maps to a real `AnsiColor`, or to `null` when the token is not a
 * color in a terminal at all. The four width presets are `null` for that
 * reason: `--mk-width-narrow` etc. are CSS lengths in `doc.css`, and this
 * engine consumes their equivalent as column arithmetic instead
 * (`./layout.ts`'s `applyLayout`), not as a printable color.
 */
export type AnsiTheme = Readonly<Record<Tier1Token, AnsiColor | null>>;

/** Parses a `#rrggbb` literal into an `[r, g, b]` triple. Used only to build the theme's truecolor entries from the hex values `doc.css` itself carries. */
function hex(value: string): readonly [number, number, number] {
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return [r, g, b];
}

/**
 * The standard xterm 216-color-cube plus grayscale-ramp formula for mapping
 * a truecolor value down to the 256-color palette: an exact gray maps into
 * the 24-step grayscale ramp (indices 232-255), everything else maps into
 * the 6x6x6 color cube (indices 16-231). This is arithmetic, not a table
 * lookup, so it introduces no dependency.
 */
function rgbToAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const toCube = (channel: number): number => Math.round((channel / 255) * 5);
  return 16 + 36 * toCube(r) + 6 * toCube(g) + toCube(b);
}

/** Builds an `AnsiColor` from a `doc.css` hex literal and a hand-picked nearest ANSI-16 foreground code (the approximation this module's comment documents). */
function color(hexValue: string, ansi16: number): AnsiColor {
  const truecolor = hex(hexValue);
  return { ansi16, ansi256: rgbToAnsi256(...truecolor), truecolor };
}

/**
 * The default theme, derived from `doc.css`'s LIGHT palette (the ten
 * neutrals, the five semantic hues; the four width tokens are `null`, see
 * `AnsiTheme`'s doc comment). Each entry's `ansi16` is a human judgment
 * call, not a formula: the nearest of the eight standard terminal colors to
 * the source hex, since 16-color terminals have no way to represent most of
 * these hues exactly. `ansi256`/`truecolor` are derived mechanically from
 * the same hex value, so only `ansi16` needed a human decision per token.
 *
 * A render option lets a caller pass a different `AnsiTheme` instead (see
 * `render.ts`'s `RenderMarkOptions.theme`).
 */
export const defaultAnsiTheme: AnsiTheme = {
  // #fff — near-white ground; nearest ANSI-16 is plain white.
  '--mk-bg': color('#ffffff', 37),
  // #fff — same as --mk-bg (raised surfaces are un-tinted in the light theme).
  '--mk-raised': color('#ffffff', 37),
  // #1a1a1a — near-black body text.
  '--mk-fg': color('#1a1a1a', 30),
  // #f4f4f5 — a hair off white.
  '--mk-surface': color('#f4f4f5', 37),
  // #f0f0f2 — a hair off white, slightly deeper than --mk-surface.
  '--mk-surface-strong': color('#f0f0f2', 37),
  // #e4e4e7 — a light hairline gray, closer to white than to black.
  '--mk-border': color('#e4e4e7', 37),
  // #52525b — a mid-dark gray; bright black (90) reads as "gray" in most terminals.
  '--mk-muted': color('#52525b', 90),
  // #94a3b8 — a light blue-gray, closer to white than to any saturated hue.
  '--mk-faint': color('#94a3b8', 37),
  // #3b82f6 — a clear blue.
  '--mk-accent': color('#3b82f6', 34),
  // #fff — ink meant to sit on a solid accent fill; white is the nearest ANSI-16.
  '--mk-on-accent': color('#ffffff', 37),
  // #3b82f6 — same blue as --mk-accent (doc.css deliberately reuses it).
  '--mk-info': color('#3b82f6', 34),
  // #15803d — a clear green.
  '--mk-success': color('#15803d', 32),
  // #d97706 — an amber; nearest ANSI-16 is plain yellow.
  '--mk-warning': color('#d97706', 33),
  // #dc2626 — a clear red.
  '--mk-danger': color('#dc2626', 31),
  // #7c3aed — a violet; nearest ANSI-16 is plain magenta.
  '--mk-limit': color('#7c3aed', 35),
  // Width presets: consumed as column arithmetic by ./layout.ts, never as a color.
  '--mk-width-fit': null,
  '--mk-width-narrow': null,
  '--mk-width-wide': null,
  '--mk-width-full': null,
};
