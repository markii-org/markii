import type { ReactElement, ReactNode } from 'react';
import type { MarkComponentProps } from '@markii/react';
import {
  failureTitle,
  isUnreadable,
  safeExtract,
  stateClassName,
  str,
} from './guard';
import './status.css';

type State = 'ok' | 'warn' | 'down' | 'unknown';

function normalizeState(raw: string): State {
  return raw === 'ok' || raw === 'warn' || raw === 'down' ? raw : 'unknown';
}

/** A bound string overrides the `state` attribute; anything else (missing, non-string, unreadable) leaves the attribute in charge. */
function extractState(data: unknown): string | undefined {
  return typeof data === 'string' ? data : undefined;
}

/**
 * `:dash_status[api server]{state=ok}` — a colored dot next to a label.
 * `state` is one of `ok`, `warn`, `down`; anything else (including no
 * attribute at all) renders a neutral "unknown" dot rather than guessing.
 * When a `data=` binding is present and resolves to a string, it overrides
 * the attribute — useful for a status that itself comes from a script
 * rather than being typed by hand. A failed or stale binding still falls
 * back to the attribute's state and only adds a `title` tooltip; the dot
 * and label never go blank.
 */
export function Status({
  attributes,
  children,
  data,
  dataStatus,
  dataError,
}: MarkComponentProps): ReactElement {
  const bound = safeExtract<string | undefined>(
    () => (isUnreadable(dataStatus) ? undefined : extractState(data)),
    () => undefined,
  );
  const raw = bound.fields ?? str(attributes.state, '');
  const state = normalizeState(raw);
  const title = failureTitle(dataError, bound.fault);
  const label: ReactNode = children ?? state;

  return (
    <span
      className={stateClassName('mk-dash_status', dataStatus)}
      title={title}
    >
      <span
        className={`mk-dash_status__dot mk-dash_status__dot--${state}`}
        aria-hidden="true"
      />
      <span className="mk-dash_status__label">{label}</span>
    </span>
  );
}
