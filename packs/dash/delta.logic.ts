import { failureTitle, isUnreadable, num, safeExtract, str } from './guard';

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
export function formatDelta(value: number): string {
  const magnitude = Number.isInteger(value)
    ? String(Math.abs(value))
    : Math.abs(value).toFixed(1);
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `-${magnitude}`;
  return magnitude;
}

export type DeltaDirection = 'up' | 'down' | 'flat';

export interface DeltaModel {
  direction: DeltaDirection;
  /** The signed value with its unit, e.g. `-0.4%`. */
  text: string;
  failureText: string | undefined;
}

/**
 * A written `value` wins over the binding; a non-numeric result from
 * either degrades to `0`, the neutral state.
 */
export function resolveDelta(input: {
  attributes: Record<string, unknown>;
  data: unknown;
  dataStatus: string | undefined;
  dataError: string | undefined;
}): DeltaModel {
  const bound = safeExtract<number | undefined>(
    () =>
      isUnreadable(input.dataStatus) ? undefined : extractValue(input.data),
    () => undefined,
  );
  const value = num(input.attributes.value, bound.fields ?? 0);
  const unit = str(input.attributes.unit, '');
  return {
    direction: value > 0 ? 'up' : value < 0 ? 'down' : 'flat',
    text: `${formatDelta(value)}${unit}`,
    failureText: failureTitle(input.dataError, bound.fault),
  };
}
