import type { HtmlComponent } from '../registry.js';

/**
 * `::::tabs :::tab{label="..."} ... ::: :::tab{label="..."} ... ::: ::::` —
 * a tabbed panel switcher.
 *
 * FAITHFULNESS LIMITATION: `@markii/react`'s `Tabs` inspects its own
 * (structured) React children to find `tab` directives, reads each one's
 * `label` attribute, and renders a `role="tablist"` button bar plus only
 * the active panel, switching on click via `useState`. This HTML engine
 * hands every component its children pre-rendered to a single opaque HTML
 * string (`childrenHtml`) — by the time `Tabs` runs, each `tab` child has
 * already been rendered by the `Tab` component above into its own
 * `.mk-tab` panel, and the `label` attribute that lived on each `tab`
 * directive is gone; there is no supported way for this component to
 * recover it, and the engine's render pipeline (`render.ts`) is explicitly
 * out of scope to change for this.
 *
 * So this is the simplest correct rendering available from a string: every
 * tab panel is shown, in document order, with no tablist button bar and no
 * JS-driven active-tab switching (this package is zero-JS by design; see
 * `@markii/html`'s package description). A reader sees all tabs' content at
 * once, wrapped in `.mk-tabs` so the surrounding CSS still applies to
 * whatever it can (panel spacing via `.mk-tab`). Static-HTML consumers
 * (publishing, CI, archive) generally want the content anyway, and no
 * content is silently dropped. A future slice could restore full
 * faithfulness (e.g. CSS-only radio-button tabs) if `render.ts` grows a way
 * to hand a container component its children pre-parsed rather than
 * pre-rendered.
 */
export const Tabs: HtmlComponent = (_attributes, childrenHtml) => {
  if (!childrenHtml.trim()) return '';
  return `<div class="mk-tabs">${childrenHtml}</div>`;
};
