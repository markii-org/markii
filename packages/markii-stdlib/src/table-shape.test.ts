import { describe, expect, it } from 'vitest';
import { deriveTableShape } from './table-shape.js';

describe('deriveTableShape — array of objects', () => {
  it('columns are the union of keys in first-seen order', () => {
    const shape = deriveTableShape([
      { name: 'Ann', role: 'lead' },
      { name: 'Bo', role: 'dev', team: 'core' },
    ]);
    expect(shape.kind).toBe('objects');
    if (shape.kind !== 'objects') throw new Error('expected objects');
    expect(shape.columns).toEqual(['name', 'role', 'team']);
    expect(shape.rows).toEqual([
      ['Ann', 'lead', undefined],
      ['Bo', 'dev', 'core'],
    ]);
  });

  it('a columns override reorders/restricts the columns', () => {
    const shape = deriveTableShape(
      [{ name: 'Ann', role: 'lead', team: 'x' }],
      ['role', 'name'],
    );
    expect(shape.kind).toBe('objects');
    if (shape.kind !== 'objects') throw new Error('expected objects');
    expect(shape.columns).toEqual(['role', 'name']);
    expect(shape.rows).toEqual([['lead', 'Ann']]);
  });

  it('a columns override key no row has renders undefined (an empty cell)', () => {
    const shape = deriveTableShape([{ a: 1 }], ['a', 'missing']);
    if (shape.kind !== 'objects') throw new Error('expected objects');
    expect(shape.rows).toEqual([[1, undefined]]);
  });

  it('a non-object row mixed into an object array contributes empty cells, never throws', () => {
    const shape = deriveTableShape([{ a: 1 }, 'oops']);
    if (shape.kind !== 'objects') throw new Error('expected objects');
    expect(shape.columns).toEqual(['a']);
    expect(shape.rows).toEqual([[1], [undefined]]);
  });
});

describe('deriveTableShape — array of arrays', () => {
  it('rows are exactly as given, no columns', () => {
    const shape = deriveTableShape([
      [1, 2],
      [3, 4],
    ]);
    expect(shape).toEqual({
      kind: 'arrays',
      rows: [
        [1, 2],
        [3, 4],
      ],
    });
  });

  it('ignores a columns override (no keys to select from)', () => {
    const shape = deriveTableShape([[1, 2]], ['a', 'b']);
    expect(shape).toEqual({ kind: 'arrays', rows: [[1, 2]] });
  });
});

describe('deriveTableShape — array of primitives', () => {
  it('becomes one column, one cell per row', () => {
    const shape = deriveTableShape([1, 'two', null]);
    expect(shape).toEqual({
      kind: 'primitives',
      rows: [[1], ['two'], [null]],
    });
  });
});

describe('deriveTableShape — single object', () => {
  it("becomes key/value rows in the object's own key order", () => {
    const shape = deriveTableShape({ a: 1, b: 2 });
    expect(shape).toEqual({
      kind: 'keyvalue',
      rows: [
        ['a', 1],
        ['b', 2],
      ],
    });
  });

  it('a columns override selects/reorders which keys become rows', () => {
    const shape = deriveTableShape({ a: 1, b: 2, c: 3 }, ['c', 'a']);
    expect(shape).toEqual({
      kind: 'keyvalue',
      rows: [
        ['c', 3],
        ['a', 1],
      ],
    });
  });

  it('a columns override key the object does not have renders undefined', () => {
    const shape = deriveTableShape({ a: 1 }, ['a', 'nope']);
    expect(shape).toEqual({
      kind: 'keyvalue',
      rows: [
        ['a', 1],
        ['nope', undefined],
      ],
    });
  });
});

describe('deriveTableShape — empty/unsupported', () => {
  it('an empty array is empty', () => {
    expect(deriveTableShape([])).toEqual({ kind: 'empty' });
  });

  it('a bare number/string/null/undefined is empty', () => {
    expect(deriveTableShape(42)).toEqual({ kind: 'empty' });
    expect(deriveTableShape('x')).toEqual({ kind: 'empty' });
    expect(deriveTableShape(null)).toEqual({ kind: 'empty' });
    expect(deriveTableShape(undefined)).toEqual({ kind: 'empty' });
  });
});
