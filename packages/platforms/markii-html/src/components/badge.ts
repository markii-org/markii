import type { HtmlComponent } from '../registry.js';

export type BadgeVariant =
  'neutral' | 'info' | 'success' | 'warning' | 'danger';

const BADGE_VARIANTS: readonly BadgeVariant[] = [
  'neutral',
  'info',
  'success',
  'warning',
  'danger',
];

const DEFAULT_VARIANT: BadgeVariant = 'neutral';

function isBadgeVariant(value: string): value is BadgeVariant {
  return (BADGE_VARIANTS as readonly string[]).includes(value);
}

/**
 * `:badge[New]{variant=success}` — a status pill for an inline text
 * directive. Unknown/missing `variant` falls back to `neutral` rather than
 * throwing. Matches `@markii/react`'s `Badge` markup byte-for-byte so one
 * stylesheet covers both renderers.
 */
export const Badge: HtmlComponent = (attributes, childrenHtml) => {
  const rawVariant = attributes.variant ?? DEFAULT_VARIANT;
  const variant: BadgeVariant = isBadgeVariant(rawVariant)
    ? rawVariant
    : DEFAULT_VARIANT;

  return `<span class="mk-badge mk-badge--${variant}">${childrenHtml}</span>`;
};
