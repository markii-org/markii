import type { AnsiComponent } from '../registry.js';

export const DEFAULT_TAB_LABEL = 'Tab';

/**
 * `:::tab{label="..."} ... :::` — one panel of a `tabs` component
 * (`tabs.ts`). Unlike `@markii/html`'s `Tab` (which never reads `label` at
 * all — see that module's `tabs.ts` for why a string-based engine usually
 * can't reach a child directive's own attributes from its parent), THIS
 * engine's `tab` reads its OWN `label` directly, since it is rendered as
 * its OWN directive, not inspected by `tabs` from the outside: the label
 * becomes a bold heading line above the panel body. Rendered standalone
 * (outside a `tabs` parent) it shows exactly the same heading and panel.
 */
export const Tab: AnsiComponent = (attributes, childrenText, ctx) => {
  const label = attributes.label ?? DEFAULT_TAB_LABEL;
  const heading = ctx.bold(ctx.text(label));
  return childrenText ? `${heading}\n${childrenText}` : heading;
};
