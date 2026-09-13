import { describe, expect, it } from 'vitest';
import { renderMarkToAnsi } from '../render.js';

const DOC = '::::row\n:::cell\nOne\n:::\n:::cell\nTwo\n:::\n::::\n';

describe('Row / Cell', () => {
  it('places cells as columns when width is at least the threshold', () => {
    const out = renderMarkToAnsi(DOC, undefined, undefined, undefined, {
      width: 60,
    });
    const firstLine = out.trim().split('\n')[0] ?? '';
    expect(firstLine).toContain('One');
    expect(firstLine).toContain('Two');
  });

  it('stacks cells vertically below the column threshold', () => {
    const out = renderMarkToAnsi(DOC, undefined, undefined, undefined, {
      width: 40,
    });
    const lines = out.trim().split('\n');
    const oneLine = lines.find((l) => l.includes('One'));
    const twoLine = lines.find((l) => l.includes('Two'));
    expect(oneLine).not.toBe(twoLine);
    expect(oneLine).not.toContain('Two');
  });

  it('cols=2 wraps a third cell onto a new grid row', () => {
    const doc =
      '::::row{cols=2}\n:::cell\nOne\n:::\n:::cell\nTwo\n:::\n:::cell\nThree\n:::\n::::\n';
    const out = renderMarkToAnsi(doc, undefined, undefined, undefined, {
      width: 60,
    });
    const lines = out.trim().split('\n');
    const line1 = lines.find((l) => l.includes('One')) ?? '';
    const line3 = lines.find((l) => l.includes('Three')) ?? '';
    expect(line1).not.toBe(line3);
    expect(line1).toContain('Two');
  });

  it('an invalid cols value degrades to auto-fit rather than throwing', () => {
    expect(() =>
      renderMarkToAnsi('::::row{cols=7}\n:::cell\nX\n:::\n::::\n'),
    ).not.toThrow();
  });
});
