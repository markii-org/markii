import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry.js';
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
 * Never throws.
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
 * Failure presentation mirrors `ValueDirective` exactly (DESIGN.md §8,
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
  const fromData: ProgressFields =
    dataStatus === 'missing' || dataStatus === 'error'
      ? {}
      : readProgressFields(data);

  const rawMax = parseFiniteNumber(attributes.max, fromData.max ?? DEFAULT_MAX);
  const max = rawMax > 0 ? rawMax : DEFAULT_MAX;

  const rawValue = parseFiniteNumber(attributes.value, fromData.value ?? 0);
  const value = clamp(rawValue, 0, max);

  const percent = clamp((value / max) * 100, 0, 100);
  const label = attributes.label ?? null;

  return (
    <div
      className={dataStateClassName('mk-progress', dataStatus, dataFailureKind)}
      title={failureTitle(dataError, dataFailureKind)}
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
      <span className="mk-progress__percent">{Math.round(percent)}%</span>
    </div>
  );
}
