import { formatValue } from '@markii/stdlib';
import { measure } from '../measure.js';
import { safeRead } from '../resolve.js';
import { dataStateSuffix, failureToken } from '../failure-presentation.js';
import type { AnsiComponent } from '../registry.js';

const DEFAULT_MAX = 1;

function parseFiniteNumber(
  raw: string | null | undefined,
  fallback: number,
): number {
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface ProgressFields {
  value?: number;
  max?: number;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readProgressFields(data: unknown): ProgressFields {
  if (typeof data === 'number') {
    return { value: Number.isFinite(data) ? data : undefined };
  }
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    return { value: coerceNumber(record.value), max: coerceNumber(record.max) };
  }
  return {};
}

/** Block characters the bar fills with, and its widest allowed footprint (columns), sized down further when the label/percent text leaves less room. */
const FILLED_CHAR = '█';
const EMPTY_CHAR = '░';
const MAX_BAR_WIDTH = 30;
const MIN_BAR_WIDTH = 3;

/**
 * `::progress{value=3 max=5 label="tasks"}` — a meter bar. Data binding (§8)
 * mirrors `@markii/html`'s `Progress`: a bound number supplies `value`; a
 * bound object may supply `value`/`max` — explicit attributes always win.
 * Non-numeric/`NaN`/`Infinity` input falls back to `0` (value) or the
 * default `max` of `1`; the effective value is clamped to `[0, max]`.
 * Terminal form: `label bar percent`, the bar drawn with `█` (filled) and
 * `░` (empty) at up to `MAX_BAR_WIDTH` columns, narrower when the label and
 * percent text leave less room. `format`/`decimals`, when given, format the
 * `value/max` fraction for the percent readout in place of the default
 * rounded integer percent, matching `@markii/html` exactly. A failed/stale
 * binding appends the quiet failure suffix after the percent.
 */
export const Progress: AnsiComponent = (attributes, _children, ctx) => {
  const { data, dataStatus, dataFailureKind } = ctx;

  const bound = safeRead<ProgressFields>(
    () =>
      dataStatus === 'missing' || dataStatus === 'error'
        ? {}
        : readProgressFields(data),
    () => ({}),
  );
  const fromData = bound.fields;

  const rawMax = parseFiniteNumber(attributes.max, fromData.max ?? DEFAULT_MAX);
  const max = rawMax > 0 ? rawMax : DEFAULT_MAX;
  const rawValue = parseFiniteNumber(attributes.value, fromData.value ?? 0);
  const value = clamp(rawValue, 0, max);
  const percent = clamp((value / max) * 100, 0, 100);

  const label = attributes.label ?? null;
  const rawFormat = attributes.format ?? undefined;
  const percentText = rawFormat
    ? formatValue(percent / 100, rawFormat, attributes.decimals ?? undefined)
    : `${String(Math.round(percent))}%`;

  const labelPart = label ? `${ctx.text(label)} ` : '';
  const suffix = dataStateSuffix(dataStatus, dataFailureKind);
  const token = failureToken(dataFailureKind);
  const percentPart = ` ${ctx.text(percentText)}${suffix ? (token ? ctx.style(suffix, token) : ctx.dim(suffix)) : ''}`;

  const overhead = measure(labelPart) + measure(percentText) + 1;
  const barWidth = Math.max(
    MIN_BAR_WIDTH,
    Math.min(MAX_BAR_WIDTH, ctx.width - overhead),
  );
  const filledCount = Math.round((percent / 100) * barWidth);
  const bar =
    FILLED_CHAR.repeat(filledCount) + EMPTY_CHAR.repeat(barWidth - filledCount);

  return `${labelPart}${bar}${percentPart}`;
};
