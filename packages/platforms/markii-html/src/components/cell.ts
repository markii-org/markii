import type { HtmlComponent } from '../registry.js';

/**
 * `:::cell ... :::` — a transparent grouping container whose ONLY job is
 * letting several blocks count as ONE cell of `:::row`. Matches
 * `@markii/react`'s `Cell` markup byte-for-byte: a plain `<div class="mk-cell">`
 * with no look of its own (no border, background, padding, or outer margin).
 * Deliberately never reads `attributes`, matching the React component.
 */
export const Cell: HtmlComponent = (_attributes, childrenHtml) => {
  return `<div class="mk-cell">${childrenHtml}</div>`;
};
