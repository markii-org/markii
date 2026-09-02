import { deriveTableShape, formatValue, isNumericLike } from '@markii/stdlib';
import type { TableShape } from '@markii/stdlib';
import { withTextClass } from '../layout.js';
import type { HtmlComponent } from '../registry.js';
import { safeRead } from '../resolve.js';
import { dataStateClassName, failureTitle } from '../failure-presentation.js';

/** `columns="name,role"` -> `['name', 'role']`. Empty/absent/whitespace-only returns `undefined` (auto columns). */
function parseColumns(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return list.length > 0 ? list : undefined;
}

/** `limit=` as a positive integer, or `undefined` for anything else — an invalid `limit` shows every row rather than erroring. */
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
 * Renders one cell's display text: `format`/`decimals` apply only when the
 * cell's raw value is itself numeric-like, matching `@markii/react`'s
 * `Table` exactly.
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
 * shape decides the layout (`@markii/stdlib`'s `deriveTableShape`) — see
 * `@markii/react`'s `Table` for the full shape rules, which this mirrors
 * byte-for-byte in markup and class names.
 *
 * Failure presentation mirrors `Stat` exactly: the body stays quiet (the
 * same neutral "no data" empty state a genuinely empty/unbound value
 * renders) and a failed/stale binding surfaces only as a `title` tooltip
 * plus a modifier class. Never throws.
 */
export const Table: HtmlComponent = (attributes, _childrenHtml, ctx) => {
  const { data, dataStatus, dataError, dataFailureKind } = ctx;

  const columnsOverride = parseColumns(attributes.columns);
  const limit = parseLimit(attributes.limit);
  const format = attributes.format ?? undefined;
  const decimals = attributes.decimals ?? undefined;
  const caption = attributes.caption ?? null;

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
  const titleAttr = title ? ` title="${ctx.esc(title)}"` : '';
  const captionHtml = caption
    ? `<div class="mk-table__caption">${ctx.esc(caption)}</div>`
    : '';

  if (shape.kind === 'empty') {
    return (
      `<div class="${className} mk-table--empty"${titleAttr}>` +
      `${captionHtml}<div class="mk-table__empty">no data</div></div>`
    );
  }

  const cellHtml = (value: unknown): string =>
    `<td>${ctx.esc(renderCell(value, format, decimals))}</td>`;

  let tableHtml: string;
  if (shape.kind === 'objects') {
    const rows = limitRows(shape.rows, limit);
    const head = `<thead><tr>${shape.columns
      .map((column) => `<th>${ctx.esc(column)}</th>`)
      .join('')}</tr></thead>`;
    const body = `<tbody>${rows
      .map((cells) => `<tr>${cells.map(cellHtml).join('')}</tr>`)
      .join('')}</tbody>`;
    tableHtml = `<table class="mk-table__table">${head}${body}</table>`;
  } else if (shape.kind === 'arrays') {
    const rows = limitRows(shape.rows, limit);
    const body = `<tbody>${rows
      .map((cells) => `<tr>${cells.map(cellHtml).join('')}</tr>`)
      .join('')}</tbody>`;
    tableHtml = `<table class="mk-table__table">${body}</table>`;
  } else if (shape.kind === 'primitives') {
    const rows = limitRows(shape.rows, limit);
    const body = `<tbody>${rows
      .map((cells) => `<tr>${cellHtml(cells[0])}</tr>`)
      .join('')}</tbody>`;
    tableHtml = `<table class="mk-table__table">${body}</table>`;
  } else {
    const rows = limitRows(shape.rows, limit);
    const body = `<tbody>${rows
      .map(
        ([key, value]) =>
          `<tr><th scope="row">${ctx.esc(key)}</th>${cellHtml(value)}</tr>`,
      )
      .join('')}</tbody>`;
    tableHtml = `<table class="mk-table__table">${body}</table>`;
  }

  return `<div class="${className}"${titleAttr}>${captionHtml}${tableHtml}</div>`;
};
