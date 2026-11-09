import { describe, expect, it } from 'vitest';
import {
  clientToSeamColumn,
  negotiateEncoding,
  seamToClientColumn,
} from './positions.js';

// 😀 is 2 UTF-16 units, 4 UTF-8 bytes, 1 code point. é is 1, 2, 1.
const LINE = 'a😀é:cal';

describe('position encodings', () => {
  it('maps the seam column to each encoding', () => {
    const colon = LINE.indexOf(':');
    expect(colon).toBe(4);
    expect(seamToClientColumn(LINE, colon, 'utf-16')).toBe(4);
    expect(seamToClientColumn(LINE, colon, 'utf-8')).toBe(1 + 4 + 2);
    expect(seamToClientColumn(LINE, colon, 'utf-32')).toBe(3);
  });

  it('maps a client character back to the seam column', () => {
    expect(clientToSeamColumn(LINE, 4, 'utf-16')).toBe(4);
    expect(clientToSeamColumn(LINE, 7, 'utf-8')).toBe(4);
    expect(clientToSeamColumn(LINE, 3, 'utf-32')).toBe(4);
  });

  it('round-trips every character boundary', () => {
    for (const encoding of ['utf-16', 'utf-8', 'utf-32'] as const) {
      let index = 0;
      while (index <= LINE.length) {
        const client = seamToClientColumn(LINE, index, encoding);
        expect(clientToSeamColumn(LINE, client, encoding)).toBe(index);
        const next = LINE.codePointAt(index);
        index += next !== undefined && next > 0xffff ? 2 : 1;
      }
    }
  });

  it('clamps past the end of the line', () => {
    expect(clientToSeamColumn('ab', 99, 'utf-8')).toBe(2);
    expect(seamToClientColumn('ab', 99, 'utf-32')).toBe(2);
  });

  it('negotiates the first supported encoding the client offers', () => {
    expect(negotiateEncoding(['utf-8', 'utf-16'])).toBe('utf-8');
    expect(negotiateEncoding(['utf-7', 'utf-32'])).toBe('utf-32');
    expect(negotiateEncoding(undefined)).toBe('utf-16');
    expect(negotiateEncoding(['nonsense'])).toBe('utf-16');
  });
});
