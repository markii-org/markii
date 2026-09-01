import type { ReactElement } from 'react';
import { withTextClass } from '../layout.js';
import type { MarkComponentProps } from '../registry.js';

/**
 * `:::card{title="..."} ... :::` — a titled panel. `title` is optional; the
 * title row is omitted entirely (not rendered empty) when absent. `text`
 * (`left | center | right`) aligns the panel's own text, title and body
 * alike. No outer margin: the document stylesheet (`.doc > * + *`) owns
 * spacing between this and its siblings.
 */
export function Card({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const title = attributes.title ?? null;

  return (
    <div className={withTextClass('mk-card', attributes.text)}>
      {title ? <div className="mk-card__title">{title}</div> : null}
      <div className="mk-card__body">{children}</div>
    </div>
  );
}
