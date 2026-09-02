import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import {
  failureTitle,
  isUnreadable,
  num,
  safeExtract,
  stateClassName,
  str,
} from './guard';
import './gauge.css';

const WIDTH = 120;
const HEIGHT = 80;
const CENTER_X = 60;
const CENTER_Y = 60;
const RADIUS = 50;
const CIRCUMFERENCE = Math.PI * RADIUS;
const TRACK_PATH = `M ${String(CENTER_X - RADIUS)} ${String(CENTER_Y)} A ${String(RADIUS)} ${String(RADIUS)} 0 0 1 ${String(CENTER_X + RADIUS)} ${String(CENTER_Y)}`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Reads a value off a bound value: a bare finite number, or a plain object's finite `.value` field. Anything else yields `undefined`. */
function extractValue(data: unknown): number | undefined {
  if (typeof data === 'number') return Number.isFinite(data) ? data : undefined;
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const raw = (data as Record<string, unknown>).value;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  return undefined;
}

/** Formats the displayed number: integers plain, everything else to one decimal place. */
function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

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
  const min = num(attributes.min, 0);
  const rawMax = num(attributes.max, 100);
  const max = rawMax > min ? rawMax : min + 1;

  const bound = safeExtract<number | undefined>(
    () => (isUnreadable(dataStatus) ? undefined : extractValue(data)),
    () => undefined,
  );
  const fromData = bound.fields;
  const rawValue = num(attributes.value, fromData ?? min);
  const value = clamp(rawValue, min, max);

  // `max - min` overflows to Infinity for a legal-but-absurd range such as
  // `min=-1e308 max=1e308`, and `Infinity / Infinity` is `NaN`. A `NaN` in
  // `stroke-dasharray` is not a quiet empty state: the browser drops the
  // whole attribute and paints the arc FULL, so an unreadable range would
  // read as 100%. An unusable span draws an empty arc instead.
  const span = max - min;
  const fraction =
    Number.isFinite(span) && span > 0 ? clamp((value - min) / span, 0, 1) : 0;
  const dashArray = `${String(fraction * CIRCUMFERENCE)} ${String(CIRCUMFERENCE)}`;

  const label = str(attributes.label, '');
  const unit = str(attributes.unit, '');
  const title = failureTitle(dataError, bound.fault);

  return (
    <div className={stateClassName('mk-dash_gauge', dataStatus)} title={title}>
      <svg
        className="mk-dash_gauge__svg"
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`${label !== '' ? `${label}: ` : ''}${formatValue(value)}${unit}`}
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
          {formatValue(value)}
          {unit}
        </text>
      </svg>
      {label !== '' && <span className="mk-dash_gauge__label">{label}</span>}
    </div>
  );
}
