import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry.js';

/**
 * `:::card{title="..."} ... :::` — a titled panel. `title` is optional; the
 * title row is omitted entirely (not rendered empty) when absent. No outer
 * margin: the document stylesheet (`.doc > * + *`) owns spacing between
 * this and its siblings.
 */
export function Card({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const title = attributes.title ?? null;

  return (
    <div className="mk-card">
      {title ? <div className="mk-card__title">{title}</div> : null}
      <div className="mk-card__body">{children}</div>
    </div>
  );
}
