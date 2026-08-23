import type { HtmlComponent } from '../registry.js';

export type CalloutType = 'info' | 'warning' | 'danger';

const CALLOUT_TYPES: readonly CalloutType[] = ['info', 'warning', 'danger'];

const CALLOUT_ICONS: Record<CalloutType, string> = {
  info: 'ℹ',
  warning: '▲',
  danger: '✕',
};

function isCalloutType(value: string): value is CalloutType {
  return (CALLOUT_TYPES as readonly string[]).includes(value);
}

/**
 * `:::callout{type=info|warning|danger title="..."}` — a colored box for an
 * aside, warning, or danger note. Unknown/missing `type` falls back to
 * `info` rather than throwing. Matches `@markii/react`'s `Callout` markup
 * byte-for-byte so one stylesheet covers both renderers. No outer margin:
 * the document stylesheet owns spacing between this and its siblings.
 */
export const Callout: HtmlComponent = (attributes, childrenHtml, ctx) => {
  const rawType = attributes.type ?? 'info';
  const type: CalloutType = isCalloutType(rawType) ? rawType : 'info';
  const title = attributes.title ?? null;

  const titleHtml = title
    ? `<span class="mk-callout__title">${ctx.esc(title)}</span>`
    : '';

  return (
    `<div class="mk-callout mk-callout--${type}" role="note">` +
    `<div class="mk-callout__header">` +
    `<span class="mk-callout__icon" aria-hidden="true">${CALLOUT_ICONS[type]}</span>` +
    `${titleHtml}</div>` +
    `<div class="mk-callout__body">${childrenHtml}</div></div>`
  );
};
