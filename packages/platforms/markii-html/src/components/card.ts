import type { HtmlComponent } from '../registry.js';

/**
 * `:::card{title="..."} ... :::` — a titled panel. `title` is optional; the
 * title row is omitted entirely (not rendered empty) when absent. Matches
 * `@markii/react`'s `Card` markup byte-for-byte so one stylesheet covers
 * both renderers. No outer margin: the document stylesheet owns spacing
 * between this and its siblings.
 */
export const Card: HtmlComponent = (attributes, childrenHtml, ctx) => {
  const title = attributes.title ?? null;
  const titleHtml = title
    ? `<div class="mk-card__title">${ctx.esc(title)}</div>`
    : '';

  return (
    `<div class="mk-card">${titleHtml}` +
    `<div class="mk-card__body">${childrenHtml}</div></div>`
  );
};
