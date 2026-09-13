/**
 * The one place control characters are removed from author text before it
 * reaches this engine's output (security critical). A Markii note is
 * untrusted text: without this module, a note containing a raw ESC byte
 * could move the terminal's cursor, recolor everything after it, or smuggle
 * an OSC 8 hyperlink into the reader's terminal, all through nothing more
 * exotic than a code fence or a link's visible text. The only escape
 * sequences this engine's output ever carries are the ones `./ansi.ts`
 * itself generates.
 *
 * Every piece of text that reaches the rendered output must pass through
 * one of the three functions below before it is printed: an attribute
 * value a component prints, a resolved stored value, a URL, alt text, code,
 * and a code fence's language label all qualify. There is no fourth path.
 */

/** Every C0 control code point (U+0000 to U+001F) plus DEL (U+007F). */
function isC0OrDel(code: number): boolean {
  return (code >= 0x00 && code <= 0x1f) || code === 0x7f;
}

/** Every C1 control code point (U+0080 to U+009F), including the C1 CSI (U+009B). */
function isC1(code: number): boolean {
  return code >= 0x80 && code <= 0x9f;
}

/**
 * Sanitizes INLINE author text (a paragraph, a heading, link text, alt
 * text, an attribute value a component prints): every C0 control (ESC
 * included) and DEL, and every C1 control, is removed. A tab, carriage
 * return, or line feed collapses to a single space instead of vanishing
 * outright, since those three are the ones a reader would otherwise
 * perceive as "the words ran together" rather than "a character was
 * stripped". Everything else passes through unchanged.
 */
export function stripControlCharacters(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      result += ' ';
      continue;
    }
    if (isC0OrDel(code) || isC1(code)) continue;
    result += char;
  }
  return result;
}

/** The fixed number of spaces one tab expands to inside a preformatted block. Matches the common terminal default. */
export const BLOCK_TAB_WIDTH = 4;

/**
 * Sanitizes PREFORMATTED text (a code fence's body): CRLF and a lone CR
 * both normalize to LF so a block's line breaks behave consistently
 * regardless of the author's line-ending style, LF itself is kept (a code
 * block is allowed to span lines), and a tab expands to `BLOCK_TAB_WIDTH`
 * spaces so `./measure.ts`'s width accounting never has to special-case a
 * tab stop. Every other C0 control (ESC included), DEL, and C1 control is
 * dropped outright: unlike inline text, a code block has no "reads as a
 * word boundary" fallback worth preserving for a stray control byte.
 */
export function sanitizeBlockText(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let result = '';
  for (const char of normalized) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a) {
      result += '\n';
      continue;
    }
    if (code === 0x09) {
      result += ' '.repeat(BLOCK_TAB_WIDTH);
      continue;
    }
    if (isC0OrDel(code) || isC1(code)) continue;
    result += char;
  }
  return result;
}

/**
 * Sanitizes a URL immediately before it is embedded in an OSC 8 hyperlink
 * sequence (`./ansi.ts`'s `hyperlink`). OSC 8's own terminator is BEL
 * (U+0007) or ST, so a BEL or ESC byte smuggled into the URL text would
 * prematurely close the engine's own escape sequence and let whatever
 * follows be interpreted as raw terminal input; every C0 control, DEL, and
 * C1 control is removed for that reason. A space is dropped too: OSC 8's
 * URL parameter is not a place a real URL would ever legitimately contain
 * one, and stripping it removes one more way to pad a payload without
 * having to reason about whether some particular terminal treats a literal
 * space specially inside the sequence.
 */
export function sanitizeUrlText(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x20) continue;
    if (isC0OrDel(code) || isC1(code)) continue;
    result += char;
  }
  return result;
}
