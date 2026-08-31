import type { HtmlComponent } from '../registry.js';

export type DividerVariant = 'line' | 'dots' | 'ornament';

const DIVIDER_VARIANTS: readonly DividerVariant[] = [
  'line',
  'dots',
  'ornament',
];

const ORNAMENT_GLYPH = '❖';

function isDividerVariant(value: string): value is DividerVariant {
  return (DIVIDER_VARIANTS as readonly string[]).includes(value);
}

/**
 * `::divider` / `::divider{label="..." variant="line|dots|ornament"}` — a
 * leaf directive rendering a horizontal separator, optionally labeled.
 * Unknown/missing/bare-null `variant` falls back to `line` rather than
 * throwing, matching `callout`'s posture for its `type` attribute. Matches
 * `@markii/react`'s `Divider` markup byte-for-byte so one stylesheet
 * covers both renderers. No outer margin: the document stylesheet owns
 * spacing between this and its siblings.
 */
export const Divider: HtmlComponent = (attributes, _childrenHtml, ctx) => {
  const rawVariant = attributes.variant ?? 'line';
  const variantName: DividerVariant = isDividerVariant(rawVariant)
    ? rawVariant
    : 'line';
  const rawLabel = attributes.label ?? null;
  const label = rawLabel ? rawLabel : null;

  const ariaLabel = label ? ` aria-label="${ctx.esc(label)}"` : '';
  const labelSpan = label
    ? `<span class="mk-divider__label">${ctx.esc(label)}</span>`
    : '';

  let inner: string;
  if (variantName === 'ornament') {
    const ornamentSpan = `<span class="mk-divider__ornament" aria-hidden="true">${ORNAMENT_GLYPH}</span>`;
    inner = label ? `${ornamentSpan}${labelSpan}${ornamentSpan}` : ornamentSpan;
  } else {
    inner = labelSpan;
  }

  return (
    `<div class="mk-divider mk-divider--${variantName}" role="separator"${ariaLabel}>` +
    `${inner}</div>`
  );
};
