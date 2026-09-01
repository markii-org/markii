import { withTextClass } from '../layout.js';
import type { HtmlComponent } from '../registry.js';

/**
 * `:::cell ... :::` — a transparent grouping container whose ONLY job is
 * letting several blocks count as ONE cell of `:::row`. Matches
 * `@markii/react`'s `Cell` markup byte-for-byte: a plain `<div class="mk-cell">`
 * with no look of its own (no border, background, padding, or outer margin).
 * Its one attribute is `text` (`left | center | right`), which aligns the
 * content inside this cell and overrides the enclosing `:::row{text=...}`
 * by declaring a value where the row only offered an inherited one.
 * Matches the React component.
 */
export const Cell: HtmlComponent = (attributes, childrenHtml) => {
  return `<div class="${withTextClass('mk-cell', attributes.text)}">${childrenHtml}</div>`;
};
