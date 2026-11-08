import { failureTitle, isUnreadable, num, safeExtract, str } from './guard';

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
export function formatGaugeValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export interface GaugeModel {
  /** The value, clamped into `[min, max]`. */
  value: number;
  /** Where `value` sits in the range, 0..1; `0` for an unusable span. */
  fraction: number;
  label: string;
  unit: string;
  failureText: string | undefined;
}

/**
 * A written `value` wins over the binding; either is clamped into the range,
 * and the range itself is guarded against a non-positive or overflowing span
 * (`min=-1e308 max=1e308` would otherwise turn the fraction into NaN, which
 * a drawing must not read as "full").
 */
export function resolveGauge(input: {
  attributes: Record<string, unknown>;
  data: unknown;
  dataStatus: string | undefined;
  dataError: string | undefined;
}): GaugeModel {
  const { attributes } = input;
  const min = num(attributes.min, 0);
  const rawMax = num(attributes.max, 100);
  const max = rawMax > min ? rawMax : min + 1;

  const bound = safeExtract<number | undefined>(
    () =>
      isUnreadable(input.dataStatus) ? undefined : extractValue(input.data),
    () => undefined,
  );
  const rawValue = num(attributes.value, bound.fields ?? min);
  const value = clamp(rawValue, min, max);

  const span = max - min;
  const fraction =
    Number.isFinite(span) && span > 0 ? clamp((value - min) / span, 0, 1) : 0;

  return {
    value,
    fraction,
    label: str(attributes.label, ''),
    unit: str(attributes.unit, ''),
    failureText: failureTitle(input.dataError, bound.fault),
  };
}
