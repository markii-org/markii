import type { ReactElement } from 'react';
import { formatValue } from '@markii/stdlib';
import type { MarkComponentProps } from '../registry.js';
import { safeRead } from '../safe-data.js';
import { dataStateClassName, failureTitle } from './failure-presentation.js';

const DEFAULT_MAX = 1;

/** Parses a numeric string defensively: non-numeric, `NaN`, and `±Infinity` all fall back to `fallback` rather than propagating a broken number. */
function parseFiniteNumber(
  raw: string | null | undefined,
  fallback: number,
): number {
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A bound `data=` object's recognized fields (§8), read defensively — anything else contributes nothing. */
interface ProgressFields {
  value?: number;
  max?: number;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Reads `value`/`max` off a bound `data` value: a bare finite number
 * supplies `value` alone; a plain object may supply either/both fields.
 *
 * MAY THROW for a hostile bound value — `Array.isArray` and both field reads
 * below go through whatever traps/getters a host put on the object. The
 * guard is at the call site (`safeRead`, `../safe-data`), which wraps the
 * whole extraction rather than each read; see that module for why. Only
 * finite numbers ever leave here, so nothing hostile escapes the guard.
 */
function readProgressFields(data: unknown): ProgressFields {
  if (typeof data === 'number') {
    return { value: Number.isFinite(data) ? data : undefined };
  }
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    return {
      value: coerceNumber(record.value),
      max: coerceNumber(record.max),
    };
  }
  return {};
}

/**
 * `::progress{value=3 max=5 label="tasks"}` — a meter bar. Data binding
 * (§8): a bound numeric `data` supplies `value`; a bound object may supply
 * `value`/`max` — explicit directive attributes always win. Parses
 * defensively: non-numeric/`NaN`/`Infinity` input (from either source)
 * falls back to `0` (value) or the default `max` of `1`; `value` is then
 * clamped to `[0, max]` and `max` is guarded to be positive. Missing/error
 * binding renders a `0%` bar rather than crashing.
 *
 * `format`/`decimals` (docs/format.md), when present, format the fraction
 * `value/max` through `@markii/stdlib`'s `formatValue` for the percent
 * readout instead of the default rounded integer (e.g.
 * `::progress{value=1 max=3 format=percent decimals=1}` shows `33.3%`
 * rather than `33%`); absent `format` keeps exactly today's behavior.
 *
 * Failure presentation mirrors `ValueDirective` exactly (docs/scripting.md,
 * AGENTS.md's cleanliness principle): the BODY stays quiet — the ordinary
 * bar, at `0%` when nothing resolved — and a failed/stale binding surfaces
 * only as a `title` tooltip plus a modifier class on the root element
 * (`mk-progress--stale`, `mk-progress--tier-blocked`, ...), both produced by
 * `./failure-presentation`. Kind-specific wording is NEVER written into the
 * bar's label or any other body text.
 */
export function Progress({
  attributes,
  data,
  dataStatus,
  dataError,
  dataFailureKind,
}: MarkComponentProps): ReactElement {
  // `safeRead` (`../safe-data`) is what keeps this component inside the
  // renderer's never-throw guarantee for a HOSTILE bound value (a revoked
  // `Proxy`, throwing getters): an unreadable binding degrades to no fields
  // at all — the same quiet `0%` bar a missing binding already renders —
  // with the thrown message going only to the tooltip, never the body.
  const bound = safeRead<ProgressFields>(
    () =>
      dataStatus === 'missing' || dataStatus === 'error'
        ? {}
        : readProgressFields(data),
    () => ({}),
  );
  const fromData = bound.fields;

  const rawMax = parseFiniteNumber(attributes.max, fromData.max ?? DEFAULT_MAX);
  const max = rawMax > 0 ? rawMax : DEFAULT_MAX;

  const rawValue = parseFiniteNumber(attributes.value, fromData.value ?? 0);
  const value = clamp(rawValue, 0, max);

  const percent = clamp((value / max) * 100, 0, 100);
  const label = attributes.label ?? null;

  // `format`/`decimals` (docs/format.md) format the fraction `value/max`
  // (e.g. `format=percent decimals=1` -> `42.3%`) in place of the default
  // rounded integer percent; absent `format` keeps today's exact behavior
  // rather than adopting `formatValue`'s own default decimal count, so
  // this attribute pair only ever changes output when an author asks.
  const rawFormat = attributes.format ?? undefined;
  const percentText = rawFormat
    ? formatValue(percent / 100, rawFormat, attributes.decimals ?? undefined)
    : `${String(Math.round(percent))}%`;

  return (
    <div
      className={dataStateClassName('mk-progress', dataStatus, dataFailureKind)}
      title={failureTitle(dataError ?? bound.fault, dataFailureKind)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      {label ? <span className="mk-progress__label">{label}</span> : null}
      <div className="mk-progress__track">
        <div
          className="mk-progress__bar"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <span className="mk-progress__percent">{percentText}</span>
    </div>
  );
}
