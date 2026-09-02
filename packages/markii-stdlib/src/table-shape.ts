/**
 * The pure "what does a bound value look like as a table" logic behind
 * `::table` (docs/format.md), shared by `@markii/react` and `@markii/html`
 * so the same bound value produces the same rows/columns in both engines —
 * exactly the reasoning `@markii/stdlib`'s `layout.ts` gives for keeping the
 * width/align preset vocabulary in one neutral place instead of two
 * hand-copied renderer implementations.
 *
 * Zero dependency, no rendering concerns: this module only classifies a
 * JS value into rows and (when there are any) column headers. Formatting a
 * cell's value to display text is `formatValue`'s job (`./value-format.ts`);
 * building markup is each renderer's own.
 */

/** A bound array of plain objects: columns = the union of keys in first-seen order (or `columns=`, when given), each row's cells aligned to them. */
export interface ObjectRowsTableShape {
  kind: 'objects';
  columns: string[];
  rows: unknown[][];
}

/** A bound array of arrays: rows exactly as given, no column headers. */
export interface ArrayRowsTableShape {
  kind: 'arrays';
  rows: unknown[][];
}

/** A bound array of primitives (numbers, strings, booleans, `null`): one column, one cell per row. */
export interface PrimitiveRowsTableShape {
  kind: 'primitives';
  rows: unknown[][];
}

/** A bound single plain object: one row per key, in `columns=` order when given, otherwise the object's own key order. */
export interface KeyValueTableShape {
  kind: 'keyvalue';
  rows: Array<[key: string, value: unknown]>;
}

/** An empty array, or a bound value that is neither an array nor a plain object (a bare number/string, `null`, `undefined`): nothing to show as a table. */
export interface EmptyTableShape {
  kind: 'empty';
}

export type TableShape =
  | ObjectRowsTableShape
  | ArrayRowsTableShape
  | PrimitiveRowsTableShape
  | KeyValueTableShape
  | EmptyTableShape;

/** A plain (non-array, non-`null`) object — the shape test every branch below needs. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Reads `key` off `object` without `in`/bracket access resolving a hostile
 * key (`'__proto__'`, `'constructor'`, `'toString'`) through the prototype
 * chain to an inherited `Object.prototype` member instead of correctly
 * reporting "this row has no such key" — the same defensive pattern
 * `./contracts.ts`'s `getContract` and every renderer's registry lookup use.
 */
function readOwn(object: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

/**
 * The union of every plain-object row's own keys, in first-seen order
 * across the whole array — not just the first row's keys — so a row later
 * in the array that carries an extra field still gets its own column
 * rather than being silently dropped. A non-object entry mixed into an
 * otherwise-object array (defensive: the format never asks authors to mix
 * shapes) contributes no keys of its own.
 */
function unionKeysInFirstSeenOrder(rows: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

/**
 * Classifies a bound `data` value into a `TableShape`, per docs/format.md's
 * four bindable shapes. `columnsOverride` is `::table`'s `columns=`
 * attribute (already split on commas and trimmed by the caller); it
 * reorders/restricts the columns of an `objects`/`keyvalue` shape and is
 * ignored for `arrays`/`primitives`, which have no keys to select from.
 *
 * MAY THROW for a hostile bound value: `Array.isArray`, `Object.keys`, and
 * every property read below go through whatever traps a host put on the
 * object. The guard is at the call site (each renderer's own `safeRead`
 * equivalent), which wraps the whole extraction rather than each read —
 * matching `stat`/`progress`/`chart`'s existing `readStatFields`/
 * `readProgressFields`/`resolvePoints` functions in both engines. Only
 * plain data (strings, the union-of-keys array, cell values already read
 * off the bound object) ever leaves here, so nothing hostile escapes the
 * guard.
 */
export function deriveTableShape(
  data: unknown,
  columnsOverride?: readonly string[],
): TableShape {
  const hasOverride =
    columnsOverride !== undefined && columnsOverride.length > 0;

  if (Array.isArray(data)) {
    if (data.length === 0) return { kind: 'empty' };

    const first = data[0];

    if (isPlainObject(first)) {
      const columns = hasOverride
        ? [...columnsOverride]
        : unionKeysInFirstSeenOrder(data);
      const rows = data.map((row) =>
        isPlainObject(row)
          ? columns.map((column) => readOwn(row, column))
          : columns.map(() => undefined),
      );
      return { kind: 'objects', columns, rows };
    }

    if (Array.isArray(first)) {
      const rows = data.map((row) => (Array.isArray(row) ? row : [row]));
      return { kind: 'arrays', rows };
    }

    return { kind: 'primitives', rows: data.map((value) => [value]) };
  }

  if (isPlainObject(data)) {
    const keys = hasOverride ? [...columnsOverride] : Object.keys(data);
    const rows: Array<[string, unknown]> = keys.map((key) => [
      key,
      readOwn(data, key),
    ]);
    return { kind: 'keyvalue', rows };
  }

  return { kind: 'empty' };
}
