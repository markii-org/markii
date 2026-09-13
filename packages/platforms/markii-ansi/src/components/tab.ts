import { childrenText, type AnsiComponent } from '../registry.js';

export const DEFAULT_TAB_LABEL = 'Tab';

/**
 * `:::tab{label="..."} ... :::` — one panel of a `tabs` component
 * (`tabs.tsx`). Rendered STANDALONE (outside a `tabs` parent, or when
 * reached through `render.tsx`'s STRING-mode fallback), it reads its own
 * `label` attribute directly and shows a bold heading above the panel body.
 * When nested under a real `tabs` directive on the ELEMENT-mode path,
 * `render.tsx`'s `extractTabPanelsElement` reads `label` itself and this
 * component is never invoked for that child — `InteractiveTabs` draws the
 * heading instead, since it needs to draw ALL headings together (the tab
 * strip / stacked list), not one at a time.
 */
export const Tab: AnsiComponent = ({ attributes, children, ctx }) => {
  const label = attributes.label ?? DEFAULT_TAB_LABEL;
  const heading = ctx.bold(ctx.text(label));
  const body = childrenText(children);
  return body ? `${heading}\n${body}` : heading;
};
