import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry.js';

const DEFAULT_TITLE = 'Details';

/**
 * `:::details{title="..." open} ... :::` — a collapsible disclosure, folded
 * by default. Uses the native `<details>`/`<summary>` elements, so the
 * expand/collapse behavior is zero-JS and comes free with accessibility
 * (keyboard toggle, `<summary>`'s built-in disclosure semantics). `open` is
 * a bare attribute (present -> starts expanded); anything else about the
 * value is irrelevant, matching how other bare attributes are read
 * elsewhere in this registry. No outer margin: the document stylesheet
 * (`.doc > * + *`) owns spacing between this and its siblings.
 */
export function Details({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const title = attributes.title ?? DEFAULT_TITLE;
  const open = Object.hasOwn(attributes, 'open');

  return (
    <details className="mk-details" open={open}>
      {/* `data-mk-interactive` matches `@markii/stdlib`'s `INTERACTIVE_ATTRIBUTE` (#53); see `tabs.tsx`'s top comment for why it is a literal here. */}
      <summary className="mk-details__summary" data-mk-interactive="">
        {title}
      </summary>
      <div className="mk-details__body">{children}</div>
    </details>
  );
}
