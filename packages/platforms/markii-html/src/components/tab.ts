import type { HtmlComponent } from '../registry.js';

/** Default label used when a `tab` directive has no `label` attribute (kept for parity with `@markii/react`; the HTML engine has no way to surface it, see `tabs.ts`). */
export const DEFAULT_TAB_LABEL = 'Tab';

/**
 * The panel markup a tab shows. Matches `@markii/react`'s `TabPanel`
 * markup byte-for-byte.
 */
export function tabPanel(childrenHtml: string): string {
  return `<div class="mk-tab" role="tabpanel">${childrenHtml}</div>`;
}

/**
 * `:::tab{label="..."} ... :::` — one panel of a `tabs` component
 * (`tabs.ts`). Rendered standalone (outside a `tabs` parent), it shows its
 * own panel. `label` has no effect here: it is only meaningful to an
 * enclosing `tabs`, and (unlike `@markii/react`, which can inspect its
 * parent's structured React children) this string-based engine has no way
 * for `tabs` to read a child directive's attributes — see `tabs.ts`'s doc
 * comment for the resulting limitation.
 */
export const Tab: HtmlComponent = (_attributes, childrenHtml) =>
  tabPanel(childrenHtml);
