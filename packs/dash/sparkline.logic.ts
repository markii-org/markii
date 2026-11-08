import { failureTitle, isUnreadable, safeExtract, str } from './guard';

const MAX_POINTS = 120;

/** Extracts one point from an array entry: a finite number as-is, or a plain object's finite `.value`. Anything else is dropped. */
function coercePoint(entry: unknown): number | undefined {
  if (typeof entry === 'number')
    return Number.isFinite(entry) ? entry : undefined;
  if (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    typeof (entry as Record<string, unknown>).value === 'number'
  ) {
    const value = (entry as Record<string, unknown>).value as number;
    return Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}

/**
 * Reads the numeric series off a bound value: a plain array of numbers (or
 * `{value}` objects), or an object shaped `{values: [...]}`. Anything else
 * yields an empty series, the same quiet state as no binding at all.
 */
function extractSeries(data: unknown): number[] {
  const source = Array.isArray(data)
    ? data
    : data !== null &&
        typeof data === 'object' &&
        Array.isArray((data as Record<string, unknown>).values)
      ? ((data as Record<string, unknown>).values as unknown[])
      : undefined;
  if (source === undefined) return [];
  const points: number[] = [];
  for (const entry of source) {
    const point = coercePoint(entry);
    if (point !== undefined) points.push(point);
    if (points.length >= MAX_POINTS) break;
  }
  return points;
}

/** Formats the trailing value shown next to the label: integers plain, everything else to one decimal place. */
export function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export interface SparklineModel {
  /** The series, oldest first; empty for no usable binding. */
  points: number[];
  label: string;
  /** The last point; `0` for an empty series (never read in that case). */
  last: number;
  /** The reason a binding failed or a hostile value threw, for a tooltip. */
  failureText: string | undefined;
}

export function resolveSparkline(input: {
  attributes: Record<string, unknown>;
  data: unknown;
  dataStatus: string | undefined;
  dataError: string | undefined;
}): SparklineModel {
  const bound = safeExtract<number[]>(
    () => (isUnreadable(input.dataStatus) ? [] : extractSeries(input.data)),
    () => [],
  );
  const points = bound.fields;
  return {
    points,
    label: str(input.attributes.label, ''),
    last: points[points.length - 1] ?? 0,
    failureText: failureTitle(input.dataError, bound.fault),
  };
}
