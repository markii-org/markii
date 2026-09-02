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
import './delta.css';

/** Reads a value off a bound value: a bare finite number, or a plain object's finite `.value` field. */
function extractValue(data: unknown): number | undefined {
  if (typeof data === 'number') return Number.isFinite(data) ? data : undefined;
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const raw = (data as Record<string, unknown>).value;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  }
  return undefined;
}

/** Formats a signed change value: an explicit `+`/`-` sign, integers plain, everything else to one decimal place. */
function formatDelta(value: number): string {
  const magnitude = Number.isInteger(value)
    ? String(Math.abs(value))
    : Math.abs(value).toFixed(1);
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `-${magnitude}`;
  return magnitude;
}

/**
 * `:dash_delta[requests]{value=-3.2 unit="%"}` — an inline up/down triangle
 * with a formatted change value, followed by the directive's own text as a
 * label. A written `value` attribute always wins, matching
 * `@markii/react`'s own `progress`; with no usable attribute the number
 * comes from the bound `data` (a bare number, or an object's `.value`
 * field). A non-numeric result from either source degrades to `0`, the
 * neutral state, rather than throwing. Positive renders a success-toned up
 * triangle, negative a danger-toned down triangle, zero a neutral dash.
 * `unit` appends a suffix such as `%` to the number.
 *
 * The label is what keeps the inline form honest: the renderer marks an
 * inline directive written with nothing between its brackets as an
 * authoring mistake (a dashed underline plus a tooltip), so `dash_delta`
 * takes the thing that changed as its text rather than leaving the
 * brackets empty.
 */
export function Delta({
  attributes,
  children,
  data,
  dataStatus,
  dataError,
}: MarkComponentProps): ReactElement {
  const bound = safeExtract<number | undefined>(
    () => (isUnreadable(dataStatus) ? undefined : extractValue(data)),
    () => undefined,
  );
  const value = num(attributes.value, bound.fields ?? 0);
  const unit = str(attributes.unit, '');
  const title = failureTitle(dataError, bound.fault);

  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';

  return (
    <span className={stateClassName('mk-dash_delta', dataStatus)} title={title}>
      <span
        className={`mk-dash_delta__arrow mk-dash_delta__arrow--${direction}`}
        aria-hidden="true"
      />
      <span
        className={`mk-dash_delta__value mk-dash_delta__value--${direction}`}
      >
        {formatDelta(value)}
        {unit}
      </span>
      {children !== undefined && children !== null && (
        <span className="mk-dash_delta__label">{children}</span>
      )}
    </span>
  );
}
