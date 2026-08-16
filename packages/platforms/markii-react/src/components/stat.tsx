import type { ReactElement, ReactNode } from 'react';
import type { MarkComponentProps } from '../registry';

const EMPTY_VALUE = '—';

type Trend = 'up' | 'down' | 'flat';

const TRENDS: readonly Trend[] = ['up', 'down', 'flat'];

function isTrend(value: string): value is Trend {
  return (TRENDS as readonly string[]).includes(value);
}

/** A `data=` object's recognized fields, read defensively (§8: `data` is an arbitrary marshalled JS value). */
interface StatFields {
  value?: string;
  label?: string;
  delta?: string;
  trend?: string;
}

/** Coerces an unknown field of a bound `data` object to a display string, or `undefined` if it isn't string/number/boolean. */
function coerceField(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

/**
 * Reads `value`/`label`/`delta`/`trend` off a bound `data` value. Only a
 * plain object contributes named fields; a bare number/string contributes
 * `value` alone. Anything else (array, `null`, `undefined`) contributes
 * nothing — never throws.
 */
function readStatFields(data: unknown): StatFields {
  if (typeof data === 'number' || typeof data === 'string') {
    return { value: String(data) };
  }
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    return {
      value: coerceField(record.value),
      label: coerceField(record.label),
      delta: coerceField(record.delta),
      trend: coerceField(record.trend),
    };
  }
  return {};
}

/** Explicit directive attributes win over the bound `data` object's own fields. */
function pick(
  attribute: string | null | undefined,
  fromData: string | undefined,
): string | undefined {
  return attribute ?? fromData ?? undefined;
}

/**
 * `::stat{value=42 label="stars" trend=up}` — a big value + label, with an
 * optional delta/trend annotation. Data binding (§8): if the bound `data`
 * value is a number/string it supplies `value`; if it is an object, its
 * `value`/`label`/`delta`/`trend` fields are read — but an explicit
 * directive attribute always wins over the bound object's field. Missing
 * value (from either source) renders `—` rather than a blank box; a missing
 * or errored binding degrades the same way. Never throws.
 */
export function Stat({
  attributes,
  data,
  dataStatus,
}: MarkComponentProps): ReactElement {
  const fromData: StatFields =
    dataStatus === 'missing' || dataStatus === 'error'
      ? {}
      : readStatFields(data);

  const value = pick(attributes.value, fromData.value);
  const label = pick(attributes.label, fromData.label);
  const delta = pick(attributes.delta, fromData.delta);
  const rawTrend = pick(attributes.trend, fromData.trend);
  const trend: Trend | undefined =
    rawTrend && isTrend(rawTrend) ? rawTrend : undefined;

  const deltaNode: ReactNode = delta ? (
    <span
      className={
        trend ? `mk-stat__delta mk-stat__delta--${trend}` : 'mk-stat__delta'
      }
    >
      {delta}
    </span>
  ) : null;

  return (
    <div className="mk-stat">
      <div className="mk-stat__value">{value || EMPTY_VALUE}</div>
      {label ? <div className="mk-stat__label">{label}</div> : null}
      {deltaNode}
    </div>
  );
}
