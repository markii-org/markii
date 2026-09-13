import { pad } from '../box.js';
import { measure } from '../measure.js';
import { safeRead } from '../resolve.js';
import { dataStateSuffix, failureToken } from '../failure-presentation.js';
import type { AnsiComponent } from '../registry.js';

type ChartKind = 'line' | 'bar';
const CHART_KINDS: readonly ChartKind[] = ['line', 'bar'];
function isChartKind(value: string): value is ChartKind {
  return (CHART_KINDS as readonly string[]).includes(value);
}
const DEFAULT_KIND: ChartKind = 'line';

/** Hard cap on rendered points, independent of source (mirrors `@markii/html`'s `Chart`). */
const MAX_POINTS = 200;

function parseNumericString(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coercePoint(entry: unknown): number | undefined {
  if (typeof entry === 'number')
    return Number.isFinite(entry) ? entry : undefined;
  if (typeof entry === 'string') return parseNumericString(entry);
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const value = (entry as Record<string, unknown>).value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') return parseNumericString(value);
  }
  return undefined;
}

/** Builds the numeric point series to plot, a bound `data` array taking priority over the static `values=` attribute. Ported from `@markii/html`'s `resolvePoints`. */
function resolvePoints(
  data: unknown,
  dataStatus: string | undefined,
  rawValues: string | null | undefined,
): number[] {
  if (
    dataStatus !== 'missing' &&
    dataStatus !== 'error' &&
    Array.isArray(data)
  ) {
    const points: number[] = [];
    for (const entry of data) {
      const point = coercePoint(entry);
      if (point !== undefined) points.push(point);
      if (points.length >= MAX_POINTS) break;
    }
    return points;
  }

  if (rawValues) {
    const points: number[] = [];
    for (const token of rawValues.split(',')) {
      const point = coercePoint(token.trim());
      if (point !== undefined) points.push(point);
      if (points.length >= MAX_POINTS) break;
    }
    return points;
  }

  return [];
}

/** `▁▂▃▄▅▆▇█`, the eight-step block-height ramp a line chart's sparkline row is built from. */
const SPARKLINE_CHARS = '▁▂▃▄▅▆▇█';

function formatPoint(value: number): string {
  return Number.isFinite(value)
    ? String(Math.round(value * 100) / 100)
    : String(value);
}

function sparkline(points: readonly number[]): string {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  return points
    .map((point) => {
      const normalized = range > 0 ? (point - min) / range : 0.5;
      const index = Math.min(
        SPARKLINE_CHARS.length - 1,
        Math.max(0, Math.round(normalized * (SPARKLINE_CHARS.length - 1))),
      );
      return SPARKLINE_CHARS[index];
    })
    .join('');
}

/** `██████` bar length for `point`, scaled against the series' largest magnitude and capped at `budget` columns. */
function barLength(
  point: number,
  maxMagnitude: number,
  budget: number,
): number {
  if (maxMagnitude <= 0) return 0;
  return Math.max(
    0,
    Math.min(budget, Math.round((Math.abs(point) / maxMagnitude) * budget)),
  );
}

/**
 * `::chart{kind=line|bar values="1,3,2,5"}` — a dependency-free, hand-rolled
 * chart. Data binding (§8) mirrors `@markii/html`'s `Chart`: a bound `data`
 * array of numbers (or `{value}` objects) takes priority over the static
 * `values=` attribute; non-numeric/non-finite entries are dropped and the
 * point count capped at `MAX_POINTS`. An empty or all-invalid series renders
 * a small neutral "no data" line rather than a broken chart.
 *
 * Terminal form: a `line` chart is a single sparkline row (`▁▂▃▄▅▆▇█`),
 * flanked by its minimum and maximum as plain numbers. A `bar` chart is one
 * horizontal `█` bar per point, its own value as the row's label, labels
 * right-aligned to the widest one so every bar starts at the same column.
 */
export const Chart: AnsiComponent = (attributes, _childrenText, ctx) => {
  const { data, dataStatus, dataFailureKind } = ctx;

  const rawKind = attributes.kind ?? DEFAULT_KIND;
  const kind: ChartKind = isChartKind(rawKind) ? rawKind : DEFAULT_KIND;

  const bound = safeRead<number[]>(
    () => resolvePoints(data, dataStatus, attributes.values),
    () => resolvePoints(undefined, 'missing', attributes.values),
  );
  const points = bound.fields;

  const suffix = dataStateSuffix(dataStatus, dataFailureKind);
  const token = failureToken(dataFailureKind);
  const styledSuffix = suffix
    ? token
      ? ctx.style(suffix, token)
      : ctx.dim(suffix)
    : '';

  if (points.length === 0) {
    return `${ctx.dim('no data')}${styledSuffix}`;
  }

  if (kind === 'line') {
    const min = ctx.dim(formatPoint(Math.min(...points)));
    const max = ctx.dim(formatPoint(Math.max(...points)));
    return `${min} ${sparkline(points)} ${max}${styledSuffix}`;
  }

  const labels = points.map((point) => formatPoint(point));
  const labelWidth = Math.max(...labels.map((label) => measure(label)));
  const budget = Math.max(1, ctx.width - labelWidth - 1);
  const maxMagnitude = Math.max(...points.map((point) => Math.abs(point)));
  const lines = points.map((point, index) => {
    const bar = '█'.repeat(barLength(point, maxMagnitude, budget));
    return `${pad(labels[index]!, labelWidth, 'right')} ${bar}`;
  });
  return `${lines.join('\n')}${styledSuffix}`;
};
