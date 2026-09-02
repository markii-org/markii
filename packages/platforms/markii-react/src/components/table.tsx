import type { ReactElement, ReactNode } from 'react';
import { deriveTableShape, formatValue, isNumericLike } from '@markii/stdlib';
import type { TableShape } from '@markii/stdlib';
import { withTextClass } from '../layout.js';
import type { MarkComponentProps } from '../registry.js';
import { safeRead } from '../safe-data.js';
import { dataStateClassName, failureTitle } from './failure-presentation.js';

/** `columns="name,role"` -> `['name', 'role']`. Empty/absent/whitespace-only returns `undefined` (auto columns). */
function parseColumns(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return list.length > 0 ? list : undefined;
}

/** `limit=` as a positive integer, or `undefined` for anything else (absent, `0`, negative, non-integer, non-numeric) — an invalid `limit` shows every row rather than erroring. */
function parseLimit(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function limitRows<T>(
  rows: readonly T[],
  limit: number | undefined,
): readonly T[] {
  return limit === undefined ? rows : rows.slice(0, limit);
}

/**
 * Renders one cell's display text: `format`/`decimals` (docs/format.md)
 * apply only when the cell's raw value is itself numeric-like (a number or
 * a numeric string) — a non-numeric cell always renders through
 * `formatValue`'s plain path, regardless of `format`, so a `format=percent`
 * table with a text column never mangles it.
 */
function renderCell(
  value: unknown,
  format: string | undefined,
  decimals: string | undefined,
): string {
  if (format && isNumericLike(value))
    return formatValue(value, format, decimals);
  return formatValue(value);
}

/**
 * `::table{data=users columns="name,role" limit=10}` — a data-bound table.
 * Data binding (§8): `data=name` resolves against the value store, and its
 * shape decides the layout (`@markii/stdlib`'s `deriveTableShape`): an array
 * of objects becomes columns from the union of keys in first-seen order (or
 * `columns=`, when given), an array of arrays becomes rows as given, an
 * array of primitives becomes a single column, and a single object becomes
 * key/value rows. `limit=` caps the number of rows shown; `caption=` adds a
 * caption; `text` aligns the table's own text.
 *
 * Failure presentation mirrors `Stat` exactly (docs/scripting.md, AGENTS.md's
 * cleanliness principle): the BODY stays quiet — the same neutral "no data"
 * empty state a genuinely empty/unbound value renders — and a failed/stale
 * binding surfaces only as a `title` tooltip plus a modifier class on the
 * root element, both produced by `./failure-presentation`. Never throws.
 */
export function Table({
  attributes,
  data,
  dataStatus,
  dataError,
  dataFailureKind,
}: MarkComponentProps): ReactElement {
  const columnsOverride = parseColumns(attributes.columns);
  const limit = parseLimit(attributes.limit);
  const format = attributes.format ?? undefined;
  const decimals = attributes.decimals ?? undefined;
  const caption = attributes.caption ?? null;

  // `safeRead` (`../safe-data`) is what keeps this component inside the
  // renderer's never-throw guarantee for a HOSTILE bound value (a revoked
  // `Proxy`, an object whose key enumeration throws): an unreadable binding
  // degrades to the same neutral empty state a missing binding already
  // renders, with the thrown message going only to the tooltip.
  const bound = safeRead<TableShape>(
    () =>
      dataStatus === 'missing' || dataStatus === 'error'
        ? { kind: 'empty' }
        : deriveTableShape(data, columnsOverride),
    () => ({ kind: 'empty' }),
  );
  const shape = bound.fields;

  const className = withTextClass(
    dataStateClassName('mk-table', dataStatus, dataFailureKind),
    attributes.text,
  );
  const title = failureTitle(dataError ?? bound.fault, dataFailureKind);
  const captionNode = caption ? (
    <div className="mk-table__caption">{caption}</div>
  ) : null;

  if (shape.kind === 'empty') {
    return (
      <div className={`${className} mk-table--empty`} title={title}>
        {captionNode}
        <div className="mk-table__empty">no data</div>
      </div>
    );
  }

  let tableNode: ReactNode;
  if (shape.kind === 'objects') {
    const rows = limitRows(shape.rows, limit);
    tableNode = (
      <table className="mk-table__table">
        <thead>
          <tr>
            {shape.columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex}>{renderCell(cell, format, decimals)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (shape.kind === 'arrays') {
    const rows = limitRows(shape.rows, limit);
    tableNode = (
      <table className="mk-table__table">
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex}>{renderCell(cell, format, decimals)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else if (shape.kind === 'primitives') {
    const rows = limitRows(shape.rows, limit);
    tableNode = (
      <table className="mk-table__table">
        <tbody>
          {rows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              <td>{renderCell(cells[0], format, decimals)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    const rows = limitRows(shape.rows, limit);
    tableNode = (
      <table className="mk-table__table">
        <tbody>
          {rows.map(([key, value], rowIndex) => (
            <tr key={rowIndex}>
              <th scope="row">{key}</th>
              <td>{renderCell(value, format, decimals)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className={className} title={title}>
      {captionNode}
      {tableNode}
    </div>
  );
}
