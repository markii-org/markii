import type { AnsiComponent } from '../registry.js';

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

/** Variant -> the theme token its chip's background reads (mirroring `@markii/html`'s color choice for the same variant). */
const VARIANT_TOKEN: Record<
  BadgeVariant,
  'success' | 'warning' | 'danger' | 'info' | 'muted'
> = {
  neutral: 'muted',
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

const TOKEN_NAME = {
  muted: '--mk-muted',
  info: '--mk-info',
  success: '--mk-success',
  warning: '--mk-warning',
  danger: '--mk-danger',
} as const;

/**
 * `:badge[New]{variant=success}` — a status pill for an inline text
 * directive. Unknown/missing `variant` falls back to `neutral` rather than
 * throwing. Terminal form: an inverse-video chip, ` label ` colored for the
 * variant. At color level `'none'` there is no inverse video to distinguish
 * a badge from surrounding text, so it degrades to `[label]` instead.
 */
export const Badge: AnsiComponent = (attributes, children, ctx) => {
  const rawVariant = attributes.variant ?? DEFAULT_VARIANT;
  const variant: BadgeVariant = isBadgeVariant(rawVariant)
    ? rawVariant
    : DEFAULT_VARIANT;

  const childrenText = children();
  if (ctx.color === 'none') return `[${childrenText}]`;

  const token = TOKEN_NAME[VARIANT_TOKEN[variant]];
  return ctx.inverse(ctx.style(` ${childrenText} `, token));
};
