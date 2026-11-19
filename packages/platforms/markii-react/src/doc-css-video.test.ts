import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.resolve(here, 'doc.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** The text of the `@media print` blocks, with their braces balanced. */
function printBlocks(source: string): string {
  let out = '';
  let from = 0;
  for (;;) {
    const start = source.indexOf('@media print', from);
    if (start === -1) return out;
    let depth = 0;
    let i = source.indexOf('{', start);
    const open = i;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) break;
    }
    out += source.slice(open + 1, i);
    from = i + 1;
  }
}

describe('doc.css: the video print badge', () => {
  const inPrint = printBlocks(css);
  const outsidePrint = css.split(inPrint).join('');

  it('draws the badge only under @media print', () => {
    expect(inPrint).toMatch(/\.mk-video__frame::after/);
    expect(inPrint).toMatch(/\.mk-video__frame::before/);
    expect(outsidePrint).not.toMatch(/\.mk-video__frame::(before|after)/);
  });

  it('takes its colors from the Tier 1 tokens', () => {
    expect(inPrint).toMatch(/var\(--mk-bg\)/);
    expect(inPrint).toMatch(/var\(--mk-border\)/);
    expect(inPrint).toMatch(/var\(--mk-fg\)/);
  });

  it('is flat: no shadow and no gradient', () => {
    expect(inPrint).not.toMatch(/shadow|gradient/);
  });
});
