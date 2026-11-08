import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { stateClassName } from './guard';
import { resolveUptime } from './uptime.logic';
import './uptime.css';

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
  const model = resolveUptime({ attributes, data, dataStatus, dataError });
  const { segments, label } = model;
  const title = model.failureText;

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
