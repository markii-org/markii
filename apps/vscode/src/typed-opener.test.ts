import { describe, expect, it } from 'vitest';
import { typedNewlineLine } from './typed-opener.js';

const at = (line: number, text: string, rangeLength = 0) => ({
  rangeLength,
  text,
  range: { start: { line } },
});

describe('typedNewlineLine', () => {
  it('names the line a bare Enter finished', () => {
    expect(typedNewlineLine(undefined, [at(4, '\n')])).toBe(4);
    expect(typedNewlineLine(undefined, [at(4, '\r\n  ')])).toBe(4);
  });

  it('ignores undo and redo', () => {
    expect(typedNewlineLine(1, [at(4, '\n')])).toBeUndefined();
    expect(typedNewlineLine(2, [at(4, '\n')])).toBeUndefined();
  });

  it('ignores a pasted block, a replacement and several changes', () => {
    expect(
      typedNewlineLine(undefined, [at(4, ':::a\nx\n:::')]),
    ).toBeUndefined();
    expect(typedNewlineLine(undefined, [at(4, '\n', 3)])).toBeUndefined();
    expect(
      typedNewlineLine(undefined, [at(1, '\n'), at(2, '\n')]),
    ).toBeUndefined();
    expect(typedNewlineLine(undefined, [])).toBeUndefined();
  });

  it('ignores ordinary typing', () => {
    expect(typedNewlineLine(undefined, [at(4, 'a')])).toBeUndefined();
  });
});
