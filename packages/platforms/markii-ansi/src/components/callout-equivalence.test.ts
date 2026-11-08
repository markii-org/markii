import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';
import { Callout } from './callout.js';
import { defaultAnsiRegistry } from './index.js';
import type { AnsiRegistry, AnsiRegistryEntry } from '../registry.js';
import type { ColorOption } from '../ansi.js';
import type { BoxStyle } from '../glyphs.js';

/**
 * The callout has two drawings: the string component (`Callout`), used
 * when a registry supplies its own wrapper or the callout sits inside a
 * string-drawn body, and the Ink element form the walk builds for the
 * standard component (a left-border bar beside a real subtree). They must
 * agree byte for byte, so the render-once output and the committed
 * fixtures do not depend on which one ran. A registry whose `callout` is a
 * wrapper around the standard component is not the standard component, so
 * the walk takes the string path for it.
 */
const stringEntry: AnsiRegistryEntry = {
  component: (props) => Callout(props),
  inline: false,
  selfLayout: true,
};
const stringRegistry: AnsiRegistry = {
  ...defaultAnsiRegistry,
  callout: stringEntry,
};

const SOURCES: Record<string, string> = {
  plain: ':::callout\nbody text\n:::\n',
  titled: ':::callout{type=warning title="Heads up"}\nbody text\n:::\n',
  danger: ':::callout{type=danger}\nfirst\n\nsecond paragraph\n:::\n',
  empty: ':::callout{type=info title="Only a title"}\n:::\n',
  wraps:
    ':::callout{title="T"}\nA long paragraph that has to wrap inside the narrow bar block more than once, at any width.\n:::\n',
  list: ':::callout\n- one\n- two\n\n> quoted\n:::\n',
  centered: ':::callout{type=warning title="Mid" text=center}\nbody\n:::\n',
  right: ':::callout{title="Right" text=right}\nbody\n\nmore\n:::\n',
  badType: ':::callout{type=bogus}\nbody\n:::\n',
  badText: ':::callout{text=sideways}\nbody\n:::\n',
  narrow: ':::callout{width=narrow}\nbody text here\n:::\n',
  centeredBlock: ':::callout{align=center title="C"}\nbody\n:::\n',
  rightBlock: ':::callout{align=right width=narrow}\nbody\n:::\n',
  nestedCard: ':::::callout\n::::card{title="In"}\ninner\n::::\n:::::\n',
  nestedRow:
    ':::::callout\n::::row{cols=2}\n:::cell\nleft\n:::\n:::cell\nright\n:::\n::::\n:::::\n',
  controlChars: ':::callout{title="a\u0007b"}\nx\u001b[31my\n:::\n',
};

/**
 * What a reader sees: each non-space character with the styles active on
 * it. The element form colors the bar glyph alone (a border cell is one
 * column) where the string form colors the glyph and its trailing space,
 * so the two differ in where an SGR pair closes and reopens around a
 * space, which no terminal draws. Comparing per visible character ignores
 * exactly that and nothing else.
 */
function visible(output: string): string[] {
  const out: string[] = [];
  let active: string[] = [];
  const pattern = /\x1b\[([0-9;]*)m|(\n)|([^\x1b])/g;
  const closes: Record<string, string[]> = {
    '22': ['1', '2'],
    '23': ['3'],
    '24': ['4'],
    '27': ['7'],
  };
  for (const match of output.matchAll(pattern)) {
    const [, params, newline, char] = match;
    if (params !== undefined) {
      if (params === '' || params === '0') active = [];
      else if (params === '39')
        active = active.filter((a) => !/^(3[0-7]|9[0-7]|38)/.test(a));
      else if (closes[params])
        active = active.filter((a) => !closes[params]?.includes(a));
      else active.push(params);
    } else if (newline !== undefined) {
      out.push('\n');
    } else if (char !== undefined && char !== ' ') {
      out.push(`${char}|${[...active].sort().join('+')}`);
    }
  }
  return out;
}

const COLORS: ColorOption[] = ['never', '16', 'truecolor'];
const BOXES: BoxStyle[] = ['unicode', 'ascii'];

describe('callout: Ink element form equals the string component', () => {
  for (const [name, source] of Object.entries(SOURCES)) {
    for (const color of COLORS) {
      for (const box of BOXES) {
        it(`${name} (${color}, ${box})`, async () => {
          const options = { width: 50, color, box } as const;
          const element = await renderMarkToAnsi(
            source,
            defaultAnsiRegistry,
            undefined,
            undefined,
            options,
          );
          const string = await renderMarkToAnsi(
            source,
            stringRegistry,
            undefined,
            undefined,
            options,
          );
          if (color === 'never') expect(element).toBe(string);
          else expect(visible(element)).toEqual(visible(string));
        });
      }
    }
  }
});
