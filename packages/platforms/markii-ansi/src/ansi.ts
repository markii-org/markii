/**
 * The escape-sequence primitives and color model this engine is built on.
 * Every helper here returns a string with no escape state left open: a
 * sequence a helper opens, it closes within the same returned string, so
 * concatenating helper outputs can never leak color or style into text a
 * later helper did not intend to touch.
 *
 * The engine never decides for itself whether color is appropriate: it has
 * no access to `process`, `stdout`, or the environment (`detectColorLevel`
 * takes both as explicit parameters), so a caller that wants automatic
 * detection has to ask for it and hand back the answer.
 */

/** What this engine will actually emit: no escapes at all, or one of three color depths. */
export type ColorLevel = 'none' | '16' | '256' | 'truecolor';

/** What a caller asks for. `'auto'` defers to `detectColorLevel`; see `resolveColorOption` for why an unresolved `'auto'` never reaches the renderer as a level on its own. */
export type ColorOption = 'auto' | 'never' | '16' | '256' | 'truecolor';

/**
 * One theme color, carrying all three depths a terminal might support so
 * `fg` can pick the right one without recomputing anything at render time.
 * `ansi16` is an SGR foreground code: 30-37 for the eight standard colors,
 * 90-97 for their bright counterparts.
 */
export interface AnsiColor {
  ansi16: number;
  ansi256: number;
  truecolor: readonly [number, number, number];
}

const ESC = '\x1b';
const RESET = `${ESC}[0m`;

/** The SGR sequence that sets `color` as the foreground at `level`, or `''` at `'none'`. */
export function fg(color: AnsiColor, level: ColorLevel): string {
  if (level === 'none') return '';
  if (level === '16') return `${ESC}[${color.ansi16}m`;
  if (level === '256') return `${ESC}[38;5;${color.ansi256}m`;
  const [r, g, b] = color.truecolor;
  return `${ESC}[38;2;${r};${g};${b}m`;
}

/**
 * Wraps `text` in `open`, closes with a full reset, and re-opens `open`
 * after every reset `text` already contained.
 *
 * Every helper in this module closes with SGR 0, which resets ALL
 * attributes rather than only the one it set, because SGR has no "undo just
 * this" code a renderer can rely on across terminals. That makes the
 * helpers safe to concatenate but not, on its own, safe to NEST: a dim
 * frame holding one colored word would lose its dim from that word onward,
 * since the word's own reset clears the frame's attribute too. Re-opening
 * after each inner reset restores the outer attribute for the remainder, so
 * a component can style text that other components already styled without
 * having to know what they did. The cost is one extra sequence per nesting
 * point, which is invisible in the terminal and stable in a fixture.
 */
function wrapSgr(text: string, open: string): string {
  const restored = text.includes(RESET)
    ? text.split(RESET).join(`${RESET}${open}`)
    : text;
  return `${open}${restored}${RESET}`;
}

/** Wraps `text` in `color`'s foreground SGR at `level`, resetting after and restoring the color after any reset `text` carried. Unchanged at `'none'`. */
export function colorize(
  text: string,
  color: AnsiColor,
  level: ColorLevel,
): string {
  if (level === 'none') return text;
  return wrapSgr(text, fg(color, level));
}

function sgrWrap(code: number): (text: string, level: ColorLevel) => string {
  return (text: string, level: ColorLevel) =>
    level === 'none' ? text : wrapSgr(text, `${ESC}[${code}m`);
}

/** SGR bold (1). Returns `text` unchanged at `'none'`. */
export const bold = sgrWrap(1);
/** SGR dim/faint (2). Returns `text` unchanged at `'none'`. */
export const dim = sgrWrap(2);
/** SGR italic (3). Returns `text` unchanged at `'none'`. */
export const italic = sgrWrap(3);
/** SGR underline (4). Returns `text` unchanged at `'none'`. */
export const underline = sgrWrap(4);
/** SGR inverse/reverse video (7). Returns `text` unchanged at `'none'`. */
export const inverse = sgrWrap(7);

/** Matches one SGR sequence, capturing its raw parameter string (empty for a bare `ESC [ m`). */
const SGR_TOKEN = /\x1b\[([0-9;]*)m/g;

/**
 * Repairs an SGR escape span that would otherwise cross an embedded `\n`
 * inside `text`, so every physical LINE is independently self-contained:
 * whatever SGR codes are still "open" (emitted since the last full reset)
 * at a line boundary are closed with a reset before the `\n` and reopened
 * at the start of the next line.
 *
 * This is the SYSTEMATIC fix for a real Ink behavior discovered during
 * batch 10's post-phase-2 review: Ink's `<Text>` does not treat an embedded
 * raw ANSI escape as transparent across an embedded newline the way a
 * terminal receiving the same bytes directly would — it resets SGR state
 * at every line boundary within one `<Text>` value and does not reopen it.
 * Every multi-line string this engine hands to a single `<Text>` node
 * (`render.tsx`'s `styledText` helper) MUST pass through this function
 * first: a dim-wrapped multi-line frame, a bold-and-underlined heading that
 * wrapped onto more than one line, a paragraph whose bold span happened to
 * straddle a wrap point — anything this engine itself line-wrapped (with
 * `text-grid.ts`'s `wrapText`) while carrying an open style. It is a no-op,
 * fast-pathed, for a string with no `\n` at all.
 *
 * Every SGR code this engine's own helpers ever emit closes with a FULL
 * reset (`\x1b[0m`), never a narrow one (`ansi.ts`'s `wrapSgr`), so
 * tracking "what is currently open" only ever needs a flat list cleared by
 * the next `\x1b[0m` (or a bare `\x1b[m`) — never per-attribute bookkeeping.
 */
export function carrySgrAcrossLines(text: string): string {
  if (!text.includes('\n')) return text;

  const lines = text.split('\n');
  let openCodes: string[] = [];
  const result: string[] = [];

  for (const line of lines) {
    const prefix = openCodes.map((params) => `${ESC}[${params}m`).join('');

    SGR_TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SGR_TOKEN.exec(line)) !== null) {
      const params = match[1] ?? '';
      if (params === '' || params === '0') {
        openCodes = [];
      } else {
        openCodes = [...openCodes, params];
      }
    }

    const suffix = openCodes.length > 0 ? RESET : '';
    result.push(`${prefix}${line}${suffix}`);
  }

  return result.join('\n');
}

/**
 * OSC 8: `ESC ] 8 ; ; url BEL text ESC ] 8 ; ; BEL`. Emitted only when
 * `level` is not `'none'`; at `'none'` this returns `text` UNCHANGED, and
 * the CALLER is responsible for appending the `(url)` form itself (this
 * function has no opinion on that wording; `render.ts` and the
 * failure-presentation module own it). The split exists because a
 * plain-text render (`'none'`) still wants the URL visible somewhere, while
 * a color-capable terminal gets the real clickable link instead.
 */
export function hyperlink(
  text: string,
  url: string,
  level: ColorLevel,
): string {
  if (level === 'none') return text;
  return `${ESC}]8;;${url}\x07${text}${ESC}]8;;\x07`;
}

/**
 * Reads color intent from an environment map and TTY flag, following (in
 * order): `NO_COLOR` (any non-empty value forces `'none'`, per the
 * no-color.org convention) beats everything else; `FORCE_COLOR` (`0` forces
 * `'none'`, `1`/`true` forces `'16'`, `2` forces `'256'`, `3` forces
 * `'truecolor'`) beats the TTY check; a non-TTY output forces `'none'`
 * (piping to a file or another program should never carry escape codes
 * unless the caller explicitly forced one above); `TERM=dumb` forces
 * `'none'`; `COLORTERM` of `truecolor`/`24bit` forces `'truecolor'`; a
 * `TERM` containing `256color` gives `'256'`; anything else that got this
 * far gets the conservative `'16'`.
 *
 * Reads NOTHING itself: no `process`, no `globalThis`. A caller (a CLI's
 * entry point, typically) supplies `env` and `isTTY` explicitly.
 */
export function detectColorLevel(
  env: Record<string, string | undefined>,
  isTTY: boolean,
): ColorLevel {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 'none';

  const forceColor = env.FORCE_COLOR;
  if (forceColor !== undefined) {
    if (forceColor === '0') return 'none';
    if (forceColor === '1' || forceColor === 'true') return '16';
    if (forceColor === '2') return '256';
    if (forceColor === '3') return 'truecolor';
  }

  if (!isTTY) return 'none';
  if (env.TERM === 'dumb') return 'none';

  const colorterm = env.COLORTERM;
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor';

  if (env.TERM?.includes('256color')) return '256';

  return '16';
}

/**
 * Resolves a caller-supplied `ColorOption` to the `ColorLevel` this engine
 * will actually use. `'never'` and `'auto'` BOTH resolve to `'none'` here:
 * the engine has no environment knowledge of its own (see this module's top
 * comment) and must never emit an escape it cannot justify, so `'auto'`
 * detection is entirely the caller's job via `detectColorLevel` — a caller
 * that wants automatic detection calls that function itself and passes the
 * resulting level in directly, rather than passing `'auto'` through to this
 * engine and hoping it guesses right. `undefined` behaves exactly like
 * `'auto'`.
 */
export function resolveColorOption(
  option: ColorOption | undefined,
): ColorLevel {
  if (option === '16' || option === '256' || option === 'truecolor') {
    return option;
  }
  return 'none';
}
