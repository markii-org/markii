import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry';

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
 * throwing. Rendered `inline-block`, baseline-aligned (see doc.css), so it
 * sits inside a line of text without disturbing line height.
 */
export function Badge({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const rawVariant = attributes.variant ?? DEFAULT_VARIANT;
  const variant: BadgeVariant = isBadgeVariant(rawVariant)
    ? rawVariant
    : DEFAULT_VARIANT;

  return <span className={`mk-badge mk-badge--${variant}`}>{children}</span>;
}
