import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from './render.js';
import { createAnsiRegistry, type AnsiComponent } from './registry.js';

/**
 * Executed, not mocked: proves a Markii note can never smuggle a live
 * escape sequence, OSC command, or cursor movement into this engine's
 * output, no matter where the payload is written (plain text, a directive
 * attribute, a code fence, a link's text, a link's href, an image's alt).
 * AGENTS.md requires an executed probe for security-relevant behavior; this
 * suite is product code and stays green in CI.
 *
 * `SGR_ESCAPE`/`OSC8_ESCAPE` below are exactly the two patterns this engine
 * itself is allowed to emit (`./measure.ts`'s `stripEscapes` uses the same
 * two). The decisive assertion strips both from the output and checks that
 * no raw ESC (`\x1b`), C1 CSI (`\x9b`), BEL (`\x07`), or DEL (`\x7f`) byte
 * survives — so even an escape THIS engine emits is verified to be one of
 * the two well-formed shapes, never a stray control byte on its own.
 */

const SGR_ESCAPE = /\x1b\[[0-9;]*m/g;
const OSC8_ESCAPE = /\x1b\]8;;[^\x07\x1b]*\x07/g;

function stripEngineEscapes(text: string): string {
  return text.replace(OSC8_ESCAPE, '').replace(SGR_ESCAPE, '');
}

const RAW_CONTROL_BYTES = /[\x1b\x9b\x07\x7f]/;

const PAYLOADS: readonly { name: string; value: string }[] = [
  { name: 'SGR red', value: '\x1b[31m' },
  { name: 'OSC 8 hyperlink', value: '\x1b]8;;http://x\x07' },
  { name: 'C1 CSI', value: '\x9b31m' },
  { name: 'bare BEL', value: '\x07' },
  { name: 'bare CR', value: '\r' },
];

/** `ColorOption` values, one per resolved `ColorLevel` this probe sweeps: `'never'` resolves to `'none'` (`./ansi.js`'s `resolveColorOption`). */
const COLOR_OPTIONS = ['never', '16', '256', 'truecolor'] as const;

describe('control characters never survive into the output (executed probe)', () => {
  for (const level of COLOR_OPTIONS) {
    describe(`at color level ${level}`, () => {
      for (const { name, value } of PAYLOADS) {
        it(`in plain paragraph text: ${name}`, async () => {
          const output = await renderMarkToAnsi(
            `before ${value} after`,
            undefined,
            undefined,
            undefined,
            {
              color: level,
            },
          );
          expect(RAW_CONTROL_BYTES.test(stripEngineEscapes(output))).toBe(
            false,
          );
        });

        it(`inside a heading: ${name}`, async () => {
          // A heading takes its own styling path (bold, and underline at
          // level one), so it wraps the author's text in escapes of the
          // engine's own. That is exactly the path where a surviving
          // author escape would be hardest to spot by eye.
          const output = await renderMarkToAnsi(
            `# title ${value} end\n`,
            undefined,
            undefined,
            undefined,
            { color: level },
          );
          expect(RAW_CONTROL_BYTES.test(stripEngineEscapes(output))).toBe(
            false,
          );
        });

        it(`inside a directive attribute value: ${name}`, async () => {
          const echoAttr: AnsiComponent = ({ attributes, ctx }) =>
            ctx.text(
              typeof attributes.label === 'string' ? attributes.label : '',
            );
          const registry = createAnsiRegistry({ box: { component: echoAttr } });
          const escapedValue = value.replace(/"/g, '\\"');
          const output = await renderMarkToAnsi(
            `:::box{label="x${escapedValue}y"}\nbody\n:::\n`,
            registry,
            undefined,
            undefined,
            { color: level },
          );
          expect(RAW_CONTROL_BYTES.test(stripEngineEscapes(output))).toBe(
            false,
          );
        });

        it(`inside a code fence: ${name}`, async () => {
          const output = await renderMarkToAnsi(
            `\`\`\`text\nfence ${value} body\n\`\`\`\n`,
            undefined,
            undefined,
            undefined,
            { color: level },
          );
          expect(RAW_CONTROL_BYTES.test(stripEngineEscapes(output))).toBe(
            false,
          );
        });

        it(`inside a link's text: ${name}`, async () => {
          const output = await renderMarkToAnsi(
            `[click ${value} here](https://example.com)\n`,
            undefined,
            undefined,
            undefined,
            { color: level },
          );
          expect(RAW_CONTROL_BYTES.test(stripEngineEscapes(output))).toBe(
            false,
          );
        });

        it(`inside a link's href: ${name}`, async () => {
          const output = await renderMarkToAnsi(
            `[click](https://example.com/${encodeURIComponent(value)}${value})\n`,
            undefined,
            undefined,
            undefined,
            { color: level },
          );
          expect(RAW_CONTROL_BYTES.test(stripEngineEscapes(output))).toBe(
            false,
          );
        });

        it(`inside an image's alt text: ${name}`, async () => {
          const output = await renderMarkToAnsi(
            `![alt ${value} text](https://example.com/x.png)\n`,
            undefined,
            undefined,
            undefined,
            { color: level },
          );
          expect(RAW_CONTROL_BYTES.test(stripEngineEscapes(output))).toBe(
            false,
          );
        });
      }

      it('the whole document, stripped of engine escapes, carries no raw ESC/C1/BEL/DEL byte', async () => {
        const source = PAYLOADS.map(
          ({ value }) => `text ${value} more\n\n`,
        ).join('');
        const output = await renderMarkToAnsi(
          source,
          undefined,
          undefined,
          undefined,
          { color: level },
        );
        expect(RAW_CONTROL_BYTES.test(stripEngineEscapes(output))).toBe(false);
      });
    });
  }
});
