import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import {
  failureTitle,
  isUnreadable,
  safeExtract,
  stateClassName,
  str,
} from './guard';
import './sparkline.css';

const WIDTH = 160;
const HEIGHT = 36;
const PAD = 3;
const MAX_POINTS = 120;

/** Extracts one point from an array entry: a finite number as-is, or a plain object's finite `.value`. Anything else is dropped. */
function coercePoint(entry: unknown): number | undefined {
  if (typeof entry === 'number')
    return Number.isFinite(entry) ? entry : undefined;
  if (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    typeof (entry as Record<string, unknown>).value === 'number'
  ) {
    const value = (entry as Record<string, unknown>).value as number;
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

/**
 * Reads the numeric series off a bound value: a plain array of numbers (or
 * `{value}` objects), or an object shaped `{values: [...]}`. Anything else
 * yields an empty series, the same quiet state as no binding at all.
 */
function extractSeries(data: unknown): number[] {
  const source = Array.isArray(data)
    ? data
    : data !== null &&
        typeof data === 'object' &&
        Array.isArray((data as Record<string, unknown>).values)
      ? ((data as Record<string, unknown>).values as unknown[])
      : undefined;
  if (source === undefined) return [];
  const points: number[] = [];
  for (const entry of source) {
    const point = coercePoint(entry);
    if (point !== undefined) points.push(point);
    if (points.length >= MAX_POINTS) break;
  }
  return points;
}

function safeCoord(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Maps `points` onto SVG coordinates, auto-scaled to the series' own min/max. A flat or single-point series lands on the vertical mid-line rather than dividing by a zero range. */
function scalePoints(
  points: readonly number[],
): Array<{ x: number; y: number }> {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  const innerWidth = WIDTH - PAD * 2;
  const innerHeight = HEIGHT - PAD * 2;
  const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;

  return points.map((value, index) => {
    const x = points.length > 1 ? PAD + step * index : WIDTH / 2;
    const normalized =
      Number.isFinite(range) && range > 0 ? (value - min) / range : 0.5;
    const y = PAD + innerHeight * (1 - normalized);
    return { x: safeCoord(x, WIDTH / 2), y: safeCoord(y, HEIGHT / 2) };
  });
}

/** Formats the trailing value shown next to the label: integers plain, everything else to one decimal place. */
function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * `::dash_sparkline{data=metric label="CPU"}` — a compact trend line for a
 * bound numeric series, hand-rolled as an SVG polyline (no charting
 * library). A leaf directive, sized to hug its own SVG so it also reads
 * well inside a `:::row` cell. The bound value may be a plain array of
 * numbers (or `{value}` objects), or `{values: [...]}`. `label`, when
 * given, is shown as a caption alongside the series' last value.
 *
 * A missing binding, an unreadable binding, or an empty/non-numeric series
 * all render the same quiet empty state per spec §4: a faint dash, with
 * the reason (when there is one) only in the `title` tooltip.
 */
export function Sparkline({
  attributes,
  data,
  dataStatus,
  dataError,
}: MarkComponentProps): ReactElement {
  const bound = safeExtract<number[]>(
    () => (isUnreadable(dataStatus) ? [] : extractSeries(data)),
    () => [],
  );
  const points = bound.fields;
  const label = str(attributes.label, '');
  const title = failureTitle(dataError, bound.fault);
  const rootClass = stateClassName('mk-dash_sparkline', dataStatus);

  if (points.length === 0) {
    return (
      <span className={`${rootClass} mk-dash_sparkline--empty`} title={title}>
        <span className="mk-dash_sparkline__placeholder" aria-hidden="true">
          –
        </span>
      </span>
    );
  }

  const scaled = scalePoints(points);
  // The `points.length === 0` early return above guarantees a last point.
  // The fallback keeps that promise checkable rather than asserted.
  const last = points[points.length - 1] ?? 0;
  const polyline = scaled
    .map((p) => `${String(safeCoord(p.x, 0))},${String(safeCoord(p.y, 0))}`)
    .join(' ');

  return (
    <span className={rootClass} title={title}>
      <svg
        className="mk-dash_sparkline__svg"
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={
          label
            ? `${label} trend, last value ${formatValue(last)}`
            : `trend, last value ${formatValue(last)}`
        }
      >
        <polyline className="mk-dash_sparkline__line" points={polyline} />
      </svg>
      {label !== '' && (
        <span className="mk-dash_sparkline__label">
          {label}{' '}
          <span className="mk-dash_sparkline__value">{formatValue(last)}</span>
        </span>
      )}
    </span>
  );
}
