/**
 * LSP position encodings. The editor seam (`@markii/stdlib/editor`) counts
 * columns in JavaScript string indices, which are UTF-16 code units. A
 * client negotiates what its `character` offsets count: UTF-16 (the
 * default and the one every client must accept), UTF-8 bytes, or UTF-32
 * code points. These two functions are the only place the difference is
 * handled; everything else in the server works in seam columns.
 */

export type PositionEncoding = 'utf-16' | 'utf-8' | 'utf-32';

export const SUPPORTED_ENCODINGS: readonly PositionEncoding[] = [
  'utf-16',
  'utf-8',
  'utf-32',
];

/** The client's most preferred encoding the server supports, else UTF-16. */
export function negotiateEncoding(offered: unknown): PositionEncoding {
  if (Array.isArray(offered)) {
    for (const entry of offered as unknown[]) {
      const match = SUPPORTED_ENCODINGS.find((known) => known === entry);
      if (match !== undefined) return match;
    }
  }
  return 'utf-16';
}

function unitsFor(codePoint: number, encoding: PositionEncoding): number {
  if (encoding === 'utf-32') return 1;
  if (encoding === 'utf-16') return codePoint > 0xffff ? 2 : 1;
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint > 0xffff ? 4 : 3;
}

/** A client `character` on `line` to a seam column (UTF-16 index), clamped to the line. A value inside a character rounds forward to its end. */
export function clientToSeamColumn(
  line: string,
  character: number,
  encoding: PositionEncoding,
): number {
  if (encoding === 'utf-16') {
    return Math.max(0, Math.min(character, line.length));
  }
  let consumed = 0;
  let index = 0;
  while (index < line.length && consumed < character) {
    const codePoint = line.codePointAt(index) ?? 0;
    consumed += unitsFor(codePoint, encoding);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return index;
}

/** A seam column (UTF-16 index) on `line` to a client `character`. */
export function seamToClientColumn(
  line: string,
  column: number,
  encoding: PositionEncoding,
): number {
  const end = Math.max(0, Math.min(column, line.length));
  if (encoding === 'utf-16') return end;
  let units = 0;
  let index = 0;
  while (index < end) {
    const codePoint = line.codePointAt(index) ?? 0;
    units += unitsFor(codePoint, encoding);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return units;
}
