import type { ReactElement, ReactNode } from 'react';
import { formatValue } from '@markii/stdlib';
import type { MarkComponentProps } from '../registry.js';
import { safeRead } from '../safe-data.js';
import { dataStateClassName, failureTitle } from './failure-presentation.js';

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
 * nothing.
 *
 * MAY THROW for a hostile bound value — `Array.isArray` and every field read
 * below go through whatever traps/getters a host put on the object. The
 * guard is at the call site (`safeRead`, `../safe-data`), which wraps the
 * whole extraction rather than each read; see that module for why. Only
 * strings ever leave here, so nothing hostile escapes the guard.
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
 *
 * `format`/`decimals` (docs/format.md) format the headline value through
 * `@markii/stdlib`'s `formatValue` before display — e.g.
 * `::stat{value=2301234 format=compact}` shows `2.3M`. Non-numeric `value`
 * under a numeric format renders unchanged (`formatValue` falls back to the
 * plain stringified value), and an absent/invalid `format` behaves as
 * `plain`, i.e. exactly today's behavior.
 *
 * Failure presentation mirrors `ValueDirective` exactly (docs/scripting.md,
 * AGENTS.md's cleanliness principle): the BODY stays quiet — `—`, or
 * whatever static attributes supplied — and a failed/stale binding surfaces
 * only as a `title` tooltip plus a modifier class on the root element
 * (`mk-stat--stale`, `mk-stat--tier-blocked`, ...), both produced by
 * `./failure-presentation`. Kind-specific wording is NEVER written into the
 * component's body text.
 */
export function Stat({
  attributes,
  data,
  dataStatus,
  dataError,
  dataFailureKind,
}: MarkComponentProps): ReactElement {
  // `safeRead` (`../safe-data`) is what keeps this component inside the
  // renderer's never-throw guarantee for a HOSTILE bound value (a revoked
  // `Proxy`, throwing getters): an unreadable binding degrades to no fields
  // at all — the same `—` body a missing binding already renders — with the
  // thrown message going only to the tooltip, never the body.
  const bound = safeRead<StatFields>(
    () =>
      dataStatus === 'missing' || dataStatus === 'error'
        ? {}
        : readStatFields(data),
    () => ({}),
  );
  const fromData = bound.fields;

  const value = pick(attributes.value, fromData.value);
  const formattedValue = formatValue(
    value,
    attributes.format ?? undefined,
    attributes.decimals ?? undefined,
  );
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
    <div
      className={dataStateClassName('mk-stat', dataStatus, dataFailureKind)}
      title={failureTitle(dataError ?? bound.fault, dataFailureKind)}
    >
      <div className="mk-stat__value">{formattedValue || EMPTY_VALUE}</div>
      {label ? <div className="mk-stat__label">{label}</div> : null}
      {deltaNode}
    </div>
  );
}
