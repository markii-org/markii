import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { stateClassName } from './guard';
import { formatValue, resolveSparkline } from './sparkline.logic';
import './sparkline.css';

const WIDTH = 160;
const HEIGHT = 36;
const PAD = 3;

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
  const model = resolveSparkline({ attributes, data, dataStatus, dataError });
  const { points, label, last } = model;
  const title = model.failureText;
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
