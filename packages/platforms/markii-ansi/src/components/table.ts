import { deriveTableShape, formatValue, isNumericLike } from '@markii/stdlib';
import type { TableShape } from '@markii/stdlib';
import { selfLayoutAlign, selfLayoutWidth } from '../layout.js';
import { safeRead } from '../resolve.js';
import { dataStateSuffix, failureToken } from '../failure-presentation.js';
import type { AnsiComponent } from '../registry.js';
import { drawTableGrid, measureTableGridWidth } from './table-grid.js';

function parseColumns(raw: string | null | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return list.length > 0 ? list : undefined;
}

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

/** Renders one cell's display text: `format`/`decimals` apply only when the cell's raw value is itself numeric-like. */
function renderCell(
  value: unknown,
  format: string | undefined,
  decimals: string | undefined,
): string {
  if (format && isNumericLike(value))
    return formatValue(value, format, decimals);
  return formatValue(value);
}

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
type TextAlign = (typeof TEXT_ALIGNS)[number];
function isTextAlign(value: string): value is TextAlign {
  return (TEXT_ALIGNS as readonly string[]).includes(value);
}

/**
 * `::table{data=users columns="name,role" limit=10}` — a data-bound table.
 * Data binding (§8): `@markii/stdlib`'s `deriveTableShape` decides the
 * layout from the bound value's own shape.
 *
 * Registered `selfLayout`: draws real box-drawing glyphs
 * (`./table-grid.ts`), so it sizes its own grid off `ctx.layout` instead of
 * letting a generic post-render narrow/pad corrupt the borders.
 */
export const Table: AnsiComponent = ({ attributes, ctx }) => {
  const { data, dataStatus, dataFailureKind } = ctx;

  const columnsOverride = parseColumns(attributes.columns);
  const limit = parseLimit(attributes.limit);
  const format = attributes.format ?? undefined;
  const decimals = attributes.decimals ?? undefined;
  const caption = attributes.caption ?? null;
  const rawTextAlign = attributes.text;
  const align: TextAlign =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : 'left';

  const bound = safeRead<TableShape>(
    () =>
      dataStatus === 'missing' || dataStatus === 'error'
        ? { kind: 'empty' }
        : deriveTableShape(data, columnsOverride),
    () => ({ kind: 'empty' }),
  );
  const shape = bound.fields;

  const suffix = dataStateSuffix(dataStatus, dataFailureKind);
  const token = failureToken(dataFailureKind);
  const styledSuffix = suffix
    ? token
      ? ctx.style(suffix, token)
      : ctx.dim(suffix)
    : '';
  const captionLine = caption ? ctx.bold(ctx.text(caption)) : undefined;

  if (shape.kind === 'empty') {
    const emptyLine = `${ctx.dim('no data')}${styledSuffix}`;
    return captionLine ? `${captionLine}\n${emptyLine}` : emptyLine;
  }

  const cell = (value: unknown): string =>
    ctx.text(renderCell(value, format, decimals));

  let header: string[] | undefined;
  let rows: string[][];
  if (shape.kind === 'objects') {
    header = shape.columns.map((column) => ctx.text(column));
    rows = limitRows(shape.rows, limit).map((cells) => cells.map(cell));
  } else if (shape.kind === 'arrays') {
    rows = limitRows(shape.rows, limit).map((cells) => cells.map(cell));
  } else if (shape.kind === 'primitives') {
    rows = limitRows(shape.rows, limit).map((cells) => [cell(cells[0])]);
  } else {
    rows = limitRows(shape.rows, limit).map(([key, value]) => [
      ctx.text(key),
      cell(value),
    ]);
  }

  const naturalWidth = measureTableGridWidth(header, rows);
  const boxWidth = selfLayoutWidth(ctx.layout, ctx.width, naturalWidth);
  const grid = drawTableGrid(
    header,
    rows,
    boxWidth,
    (text) => ctx.bold(text),
    align,
  );
  const body = `${grid}${styledSuffix}`;
  const withCaption = captionLine ? `${captionLine}\n${body}` : body;
  return selfLayoutAlign(withCaption, ctx.layout, ctx.width);
};
