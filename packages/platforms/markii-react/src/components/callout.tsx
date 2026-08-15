import type { ReactElement } from 'react';
import type { SmdComponentProps } from '../registry';

export type CalloutType = 'info' | 'warning' | 'danger';

const CALLOUT_TYPES: readonly CalloutType[] = ['info', 'warning', 'danger'];

const CALLOUT_ICONS: Record<CalloutType, string> = {
  info: 'ℹ',
  warning: '▲',
  danger: '✕',
};

function isCalloutType(value: string): value is CalloutType {
  return (CALLOUT_TYPES as readonly string[]).includes(value);
}

/**
 * `:::callout{type=info|warning|danger title="..."}` — a colored box for an
 * aside, warning, or danger note. Unknown/missing `type` falls back to
 * `info` rather than throwing. No outer margin: the document stylesheet
 * (`.doc > * + *`) owns spacing between this and its siblings.
 */
export function Callout({
  attributes,
  children,
}: SmdComponentProps): ReactElement {
  const rawType = attributes.type ?? 'info';
  const type: CalloutType = isCalloutType(rawType) ? rawType : 'info';
  const title = attributes.title ?? null;

  return (
    <div className={`mk-callout mk-callout--${type}`} role="note">
      <div className="mk-callout__header">
        <span className="mk-callout__icon" aria-hidden="true">
          {CALLOUT_ICONS[type]}
        </span>
        {title ? <span className="mk-callout__title">{title}</span> : null}
      </div>
      <div className="mk-callout__body">{children}</div>
    </div>
  );
}
