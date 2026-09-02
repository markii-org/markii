import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { str } from './guard';
import './pitfall.css';

/** Shown when no `title` is written, so the block always says what it is. */
const DEFAULT_TITLE = 'Common mistake';

/**
 * `:::prep_pitfall{title="..."}` ... `:::`, the mistake you keep making,
 * recorded next to the question that keeps catching you out.
 *
 * This is deliberately not the standard `callout`. A revision sheet is
 * mostly callout-shaped already, so a pitfall that borrowed those colors
 * would disappear into the page. It gets its own look instead: a heavier
 * inset accent edge, a rotated square marker rather than an icon, and a
 * small uppercase heading, all under the `mk-prep_` namespace so nothing
 * here can reach the standard component's styling.
 *
 * `title` is optional. Without one the block is headed "Common mistake",
 * never left unlabeled, since an unlabeled tinted box tells the reader
 * nothing about why it is tinted.
 */
export function PrepPitfall({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const title = str(attributes?.title, DEFAULT_TITLE);

  return (
    <div className="mk-prep_pitfall">
      <div className="mk-prep_pitfall__head">
        <span className="mk-prep_pitfall__marker" aria-hidden="true" />
        <span className="mk-prep_pitfall__title">{title}</span>
      </div>
      <div className="mk-prep_pitfall__body">{children}</div>
    </div>
  );
}
