import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { stateClassName } from './guard';
import { formatGaugeValue, resolveGauge } from './gauge.logic';
import './gauge.css';

const WIDTH = 120;
const HEIGHT = 80;
const CENTER_X = 60;
const CENTER_Y = 60;
const RADIUS = 50;
const CIRCUMFERENCE = Math.PI * RADIUS;
const TRACK_PATH = `M ${String(CENTER_X - RADIUS)} ${String(CENTER_Y)} A ${String(RADIUS)} ${String(RADIUS)} 0 0 1 ${String(CENTER_X + RADIUS)} ${String(CENTER_Y)}`;

/**
 * `::dash_gauge{data=cpu min=0 max=100 label="CPU" unit="%"}` — a
 * semi-circular arc gauge, hand-rolled as SVG (no charting library). A
 * written `value` attribute always wins, matching `@markii/react`'s own
 * `progress`; with no usable attribute the value comes from the bound
 * `data` (a bare number, or an object's `.value` field). Either way it
 * is clamped into `[min, max]` before it reaches the arc geometry, and
 * `min`/`max` themselves are guarded against a non-positive range. Junk
 * input (unparsable attributes, a non-numeric binding) degrades quietly
 * to the range's minimum rather than throwing or drawing a broken arc.
 */
export function Gauge({
  attributes,
  data,
  dataStatus,
  dataError,
}: MarkComponentProps): ReactElement {
  // An unusable range yields a fraction of 0 (see `resolveGauge`): a `NaN`
  // in `stroke-dasharray` would make the browser drop the attribute and
  // paint the arc FULL, so an unreadable range would read as 100%.
  const {
    value,
    fraction,
    label,
    unit,
    failureText: title,
  } = resolveGauge({
    attributes,
    data,
    dataStatus,
    dataError,
  });
  const dashArray = `${String(fraction * CIRCUMFERENCE)} ${String(CIRCUMFERENCE)}`;

  return (
    <div className={stateClassName('mk-dash_gauge', dataStatus)} title={title}>
      <svg
        className="mk-dash_gauge__svg"
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`${label !== '' ? `${label}: ` : ''}${formatGaugeValue(value)}${unit}`}
      >
        <path className="mk-dash_gauge__track" d={TRACK_PATH} />
        <path
          className="mk-dash_gauge__fill"
          d={TRACK_PATH}
          strokeDasharray={dashArray}
        />
        <text
          className="mk-dash_gauge__value"
          x={CENTER_X}
          y={CENTER_Y - 8}
          textAnchor="middle"
        >
          {formatGaugeValue(value)}
          {unit}
        </text>
      </svg>
      {label !== '' && <span className="mk-dash_gauge__label">{label}</span>}
    </div>
  );
}
