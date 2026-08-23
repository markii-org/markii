import type { HtmlComponent } from '../registry.js';

const DEFAULT_TITLE = 'Details';

/**
 * `:::details{title="..." open} ... :::` — a collapsible disclosure, folded
 * by default. `open` is a bare attribute (present -> starts expanded); any
 * value it carries is irrelevant. Matches `@markii/react`'s `Details`
 * markup byte-for-byte so one stylesheet covers both renderers. No outer
 * margin: the document stylesheet owns spacing between this and its
 * siblings.
 */
export const Details: HtmlComponent = (attributes, childrenHtml, ctx) => {
  const title = attributes.title ?? DEFAULT_TITLE;
  const open = Object.hasOwn(attributes, 'open');

  return (
    `<details class="mk-details"${open ? ' open' : ''}>` +
    `<summary class="mk-details__summary">${ctx.esc(title)}</summary>` +
    `<div class="mk-details__body">${childrenHtml}</div></details>`
  );
};
