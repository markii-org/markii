import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry';

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
 * Hard cap on rendered points, independent of source (`values=` or bound
 * `data`). A hostile or merely huge `data` array (thousands of numbers from
 * a runaway script) must not translate into thousands of SVG nodes — this
 * bounds the DOM cost regardless of input size.
 */
const MAX_POINTS = 200;

/**
 * Sane bounds for a `width`/`height` attribute. Mirrors the `MAX_POINTS`
 * philosophy: a hostile or merely careless value (e.g. `width="1e9"`) must
 * not translate into a giant viewBox / DOM footprint.
 */
const MIN_SIZE = 1;
const MAX_SIZE = 2000;

/** Parses `size` (a `height`/`width` attribute) defensively: non-numeric/non-positive input falls back to `fallback`; any finite positive value is clamped to `[MIN_SIZE, MAX_SIZE]`. */
function parseSize(size: string | null | undefined, fallback: number): number {
  if (size === null || size === undefined) return fallback;
  const parsed = Number(size);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, MIN_SIZE), MAX_SIZE);
}

/** Clamps `value` into `[0, 1]`; a non-finite input (should not occur post-`scalePoints` guards, but checked defensively) maps to the neutral mid-point `0.5`. */
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

/** Parses a numeric string strictly: empty/whitespace-only text (which `Number('')` would otherwise silently read as `0`) is treated as non-numeric, same as any other unparsable token. */
function parseNumericString(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Extracts one numeric point from an unknown array entry: a finite number as-is, or a plain object's finite `.value` field. Anything else is dropped. */
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
 * Builds the numeric point series to plot, from a bound `data` array taking
 * priority over a static `values=` attribute. Every entry is coerced and
 * filtered through `coercePoint` — non-numeric strings, `NaN`, `±Infinity`,
 * and plain objects without a usable `.value` are all dropped silently
 * rather than propagating into the geometry math below. The result is
 * capped to `MAX_POINTS` so an oversized series (however it arrived) can
 * never blow up the DOM. Never throws.
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
 * SVG coordinates, flat series mapping to the vertical mid-line. Every entry
 * is individually finite (guaranteed by `coercePoint`), but `max - min` can
 * still overflow to `Infinity` for hostile-but-finite endpoints (e.g.
 * `[1e308, -1e308]`) — a non-finite or non-positive `range` is treated as a
 * flat series (normalized to the mid-point) instead of dividing, and the
 * final `x`/`y` are clamped to finite as a last line of defense so `NaN`
 * never reaches the SVG markup.
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
 * chart (no chart library). Data binding (§8): a bound `data` array of
 * numbers (or `{value}` objects) takes priority over the static `values=`
 * attribute; a numeric-only, defensively-filtered, capped series is what
 * ever reaches the geometry math, so a hostile array (strings, `NaN`,
 * `Infinity`, nested objects) can never produce broken (`NaN`) SVG
 * coordinates. All plotted values are numbers formatted as plain digits —
 * no user-controlled text is ever interpolated into the SVG markup.
 * Missing/error binding with no static fallback renders a small neutral
 * empty state rather than a broken or empty `<svg>`. Never throws.
 */
export function Chart({
  attributes,
  data,
  dataStatus,
}: MarkComponentProps): ReactElement {
  const rawKind = attributes.kind ?? DEFAULT_KIND;
  const kind: ChartKind = isChartKind(rawKind) ? rawKind : DEFAULT_KIND;
  const width = parseSize(attributes.width, DEFAULT_WIDTH);
  const height = parseSize(attributes.height, DEFAULT_HEIGHT);

  const points = resolvePoints(data, dataStatus, attributes.values);

  if (points.length === 0) {
    return (
      <div
        className="mk-chart mk-chart--empty"
        role="img"
        aria-label="chart: no data"
        style={{ width, height }}
      >
        no data
      </div>
    );
  }

  const scaled = scalePoints(points, width, height);
  const label = `${kind} chart, ${String(points.length)} point${points.length === 1 ? '' : 's'}`;

  return (
    <svg
      className="mk-chart"
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      {kind === 'line' ? (
        <polyline
          className="mk-chart__line"
          points={scaled
            .map(
              (p) =>
                `${String(safeCoord(p.x, 0))},${String(safeCoord(p.y, 0))}`,
            )
            .join(' ')}
        />
      ) : (
        scaled.map((p, index) => {
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
            <rect
              key={index}
              className="mk-chart__bar"
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
            />
          );
        })
      )}
    </svg>
  );
}
