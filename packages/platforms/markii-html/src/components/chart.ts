import type { HtmlComponent } from '../registry.js';
import { safeRead } from '../resolve.js';
import { dataStateClassName, failureTitle } from '../failure-presentation.js';

type ChartKind = 'line' | 'bar';

const CHART_KINDS: readonly ChartKind[] = ['line', 'bar'];

function isChartKind(value: string): value is ChartKind {
  return (CHART_KINDS as readonly string[]).includes(value);
}

const DEFAULT_KIND: ChartKind = 'line';
const DEFAULT_WIDTH = 240;
const DEFAULT_HEIGHT = 60;
const PADDING = 4;

/**
 * Hard cap on rendered points, independent of source. A hostile or merely
 * huge `data` array must not translate into thousands of SVG nodes.
 */
const MAX_POINTS = 200;

/** Clamps `value` into `[0, 1]`; a non-finite input maps to the neutral mid-point `0.5`. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Returns `value` if finite, otherwise `fallback`. Last line of defense so no `NaN`/`Infinity` ever reaches emitted SVG markup. */
function safeCoord(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Parses a numeric string strictly: empty/whitespace-only text is treated as non-numeric. */
function parseNumericString(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Extracts one numeric point from an unknown array entry: a finite number as-is, or a plain object's finite `.value` field. */
function coercePoint(entry: unknown): number | undefined {
  if (typeof entry === 'number') {
    return Number.isFinite(entry) ? entry : undefined;
  }
  if (typeof entry === 'string') {
    return parseNumericString(entry);
  }
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const value = (entry as Record<string, unknown>).value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') return parseNumericString(value);
  }
  return undefined;
}

/**
 * Builds the numeric point series to plot, a bound `data` array taking
 * priority over a static `values=` attribute. MAY THROW for a hostile bound
 * value — guarded at the call site via `safeRead`.
 */
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

/**
 * Scales `points` into `[PADDING, width - PADDING] x [PADDING, height - PADDING]`
 * SVG coordinates, flat series mapping to the vertical mid-line.
 */
function scalePoints(
  points: readonly number[],
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  const innerWidth = Math.max(width - PADDING * 2, 0);
  const innerHeight = Math.max(height - PADDING * 2, 0);
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;

  return points.map((value, index) => {
    const x = points.length > 1 ? PADDING + step * index : width / 2;
    const normalized =
      Number.isFinite(range) && range > 0
        ? clamp01((value - min) / range)
        : 0.5;
    const y = PADDING + innerHeight * (1 - normalized);
    return { x: safeCoord(x, width / 2), y: safeCoord(y, height / 2) };
  });
}

/**
 * `::chart{kind=line values="1,3,2,5"}` — a minimal hand-rolled inline SVG
 * chart (no chart library; the SVG is a plain string built by this module).
 * Data binding (§8): a bound `data` array of numbers (or `{value}` objects)
 * takes priority over the static `values=` attribute; a numeric-only,
 * defensively-filtered, capped series is what ever reaches the geometry
 * math. All plotted values are numbers formatted as plain digits — no
 * user-controlled text is ever interpolated into the SVG markup.
 * Missing/error binding with no static fallback renders a small neutral
 * empty state rather than a broken or empty `<svg>`. Never throws.
 *
 * Markup and class names match `@markii/react`'s `Chart` byte-for-byte.
 */
export const Chart: HtmlComponent = (attributes, _childrenHtml, ctx) => {
  const { data, dataStatus, dataError, dataFailureKind } = ctx;

  const rawKind = attributes.kind ?? DEFAULT_KIND;
  const kind: ChartKind = isChartKind(rawKind) ? rawKind : DEFAULT_KIND;
  const width = DEFAULT_WIDTH;
  const height = DEFAULT_HEIGHT;

  const bound = safeRead<number[]>(
    () => resolvePoints(data, dataStatus, attributes.values),
    () => resolvePoints(undefined, 'missing', attributes.values),
  );
  const points = bound.fields;
  const title = failureTitle(dataError ?? bound.fault, dataFailureKind);
  const titleAttr = title ? ` title="${ctx.esc(title)}"` : '';

  if (points.length === 0) {
    const className = dataStateClassName(
      'mk-chart',
      dataStatus,
      dataFailureKind,
      ['mk-chart--empty'],
    );
    return (
      `<div class="${className}"${titleAttr} role="img" aria-label="chart: no data" ` +
      `style="width: ${String(width)}px; height: ${String(height)}px">no data</div>`
    );
  }

  const scaled = scalePoints(points, width, height);
  const label = `${kind} chart, ${String(points.length)} point${points.length === 1 ? '' : 's'}`;
  const className = dataStateClassName('mk-chart', dataStatus, dataFailureKind);
  const titleEl = title ? `<title>${ctx.esc(title)}</title>` : '';

  const body =
    kind === 'line'
      ? `<polyline class="mk-chart__line" points="${scaled
          .map(
            (p) => `${String(safeCoord(p.x, 0))},${String(safeCoord(p.y, 0))}`,
          )
          .join(' ')}" />`
      : scaled
          .map((p) => {
            const barWidth = safeCoord(
              scaled.length > 1
                ? Math.max((width - PADDING * 2) / scaled.length - 2, 1)
                : Math.max(width - PADDING * 2, 1),
              1,
            );
            const x = safeCoord(p.x - barWidth / 2, 0);
            const y = safeCoord(p.y, 0);
            const barHeight = safeCoord(Math.max(height - PADDING - y, 0), 0);
            return (
              `<rect class="mk-chart__bar" x="${String(x)}" y="${String(y)}" ` +
              `width="${String(barWidth)}" height="${String(barHeight)}" />`
            );
          })
          .join('');

  return (
    `<svg class="${className}" viewBox="0 0 ${String(width)} ${String(height)}" ` +
    `width="${String(width)}" height="${String(height)}" role="img" aria-label="${ctx.esc(label)}">` +
    `${titleEl}${body}</svg>`
  );
};
