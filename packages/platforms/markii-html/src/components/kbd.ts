import type { HtmlComponent } from '../registry.js';

/**
 * `:kbd[Ctrl+S]` — a styled keycap for an inline text directive. Matches
 * `@markii/react`'s `Kbd` markup byte-for-byte so one stylesheet covers
 * both renderers.
 */
export const Kbd: HtmlComponent = (_attributes, childrenHtml) => {
  return `<kbd class="mk-kbd">${childrenHtml}</kbd>`;
};
