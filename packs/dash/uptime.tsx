import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import {
  failureTitle,
  isUnreadable,
  safeExtract,
  stateClassName,
  str,
} from './guard';
import './uptime.css';

const MAX_SEGMENTS = 90;

type Segment = 'ok' | 'warn' | 'down' | 'unknown';

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

/**
 * `::dash_uptime{data=history label="API"}` — a segmented horizontal bar,
 * one segment per bound history entry, oldest on the left. Each entry is
 * expected to be the string `ok`, `warn`, or `down`; any other value
 * renders as a neutral "unknown" segment rather than being skipped, so the
 * bar's length still reflects the real history length. A missing,
 * unreadable, or empty binding renders a single flat neutral track instead
 * of a broken or zero-width bar.
 */
export function Uptime({
  attributes,
  data,
  dataStatus,
  dataError,
}: MarkComponentProps): ReactElement {
  const bound = safeExtract<Segment[]>(
    () => (isUnreadable(dataStatus) ? [] : extractSegments(data)),
    () => [],
  );
  const segments = bound.fields;
  const label = str(attributes.label, '');
  const title = failureTitle(dataError, bound.fault);

  return (
    <div className={stateClassName('mk-dash_uptime', dataStatus)} title={title}>
      {label !== '' && <span className="mk-dash_uptime__label">{label}</span>}
      <div
        className="mk-dash_uptime__track"
        role="img"
        aria-label={`${label !== '' ? `${label} ` : ''}uptime history, ${String(segments.length)} entries`}
      >
        {segments.length === 0 ? (
          <span className="mk-dash_uptime__segment mk-dash_uptime__segment--unknown" />
        ) : (
          segments.map((segment, index) => (
            <span
              key={index}
              className={`mk-dash_uptime__segment mk-dash_uptime__segment--${segment}`}
            />
          ))
        )}
      </div>
    </div>
  );
}
