import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';

const DOC = '::::row\n:::cell\nOne\n:::\n:::cell\nTwo\n:::\n::::\n';

describe('Row / Cell', () => {
  it('places cells as columns when width is at least the threshold', async () => {
    const out = await renderMarkToAnsi(DOC, undefined, undefined, undefined, {
      width: 60,
    });
    const firstLine = out.trim().split('\n')[0] ?? '';
    expect(firstLine).toContain('One');
    expect(firstLine).toContain('Two');
  });

  it('stacks cells vertically below the column threshold', async () => {
    const out = await renderMarkToAnsi(DOC, undefined, undefined, undefined, {
      width: 40,
    });
    const lines = out.trim().split('\n');
    const oneLine = lines.find((l) => l.includes('One'));
    const twoLine = lines.find((l) => l.includes('Two'));
    expect(oneLine).not.toBe(twoLine);
    expect(oneLine).not.toContain('Two');
  });

  it('cols=2 wraps a third cell onto a new grid row', async () => {
    const doc =
      '::::row{cols=2}\n:::cell\nOne\n:::\n:::cell\nTwo\n:::\n:::cell\nThree\n:::\n::::\n';
    const out = await renderMarkToAnsi(doc, undefined, undefined, undefined, {
      width: 60,
    });
    const lines = out.trim().split('\n');
    const line1 = lines.find((l) => l.includes('One')) ?? '';
    const line3 = lines.find((l) => l.includes('Three')) ?? '';
    expect(line1).not.toBe(line3);
    expect(line1).toContain('Two');
  });

  it('an invalid cols value degrades to auto-fit rather than throwing', async () => {
    await expect(
      renderMarkToAnsi('::::row{cols=7}\n:::cell\nX\n:::\n::::\n'),
    ).resolves.toBeTypeOf('string');
  });

  it('text=center centers each cell at the TOP level (ELEMENT mode), not only when nested inside a self-drawing container', async () => {
    // Batch 11: `renderRowElement` used to silently drop `text=` entirely —
    // only the STRING-mode fallback (reached when a `row` is nested inside
    // a `card`/`callout`) honored it. Locks in the fix: a top-level row
    // now pre-justifies each cell through `text-grid.ts`'s `padText` before
    // handing it to Ink, the same one mechanism the STRING mode always used.
    const doc = '::::row{cols=1 text=center}\n:::cell\nHi\n:::\n::::\n';
    const out = await renderMarkToAnsi(doc, undefined, undefined, undefined, {
      width: 20,
    });
    const line = out.split('\n').find((l) => l.includes('Hi')) ?? '';
    expect(line.startsWith(' ')).toBe(true);
    expect(line.trim()).toBe('Hi');
  });
});
