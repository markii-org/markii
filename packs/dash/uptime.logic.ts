import { failureTitle, isUnreadable, safeExtract, str } from './guard';

const MAX_SEGMENTS = 90;

export type Segment = 'ok' | 'warn' | 'down' | 'unknown';

function normalizeSegment(raw: unknown): Segment {
  return raw === 'ok' || raw === 'warn' || raw === 'down' ? raw : 'unknown';
}

/**
 * Reads a segment history off a bound array of strings, oldest first. Any
 * entry that is not `ok`/`warn`/`down` becomes `unknown` rather than being
 * dropped, so the bar's segment count still matches the source history.
 * Longer than `MAX_SEGMENTS` keeps only the most recent entries, still in
 * oldest-first order.
 */
function extractSegments(data: unknown): Segment[] {
  if (!Array.isArray(data)) return [];
  const trimmed =
    data.length > MAX_SEGMENTS ? data.slice(data.length - MAX_SEGMENTS) : data;
  return trimmed.map(normalizeSegment);
}

export interface UptimeModel {
  segments: Segment[];
  label: string;
  failureText: string | undefined;
}

export function resolveUptime(input: {
  attributes: Record<string, unknown>;
  data: unknown;
  dataStatus: string | undefined;
  dataError: string | undefined;
}): UptimeModel {
  const bound = safeExtract<Segment[]>(
    () => (isUnreadable(input.dataStatus) ? [] : extractSegments(input.data)),
    () => [],
  );
  return {
    segments: bound.fields,
    label: str(input.attributes.label, ''),
    failureText: failureTitle(input.dataError, bound.fault),
  };
}
