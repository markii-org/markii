import { measureWidth, padText, ruleLine } from '../text-grid.js';
import { selfLayoutAlign, selfLayoutWidth } from '../layout.js';
import type { AnsiComponent } from '../registry.js';

export type DividerVariant = 'line' | 'dots' | 'ornament';

const DIVIDER_VARIANTS: readonly DividerVariant[] = [
  'line',
  'dots',
  'ornament',
];

function isDividerVariant(value: string): value is DividerVariant {
  return (DIVIDER_VARIANTS as readonly string[]).includes(value);
}

export type DividerLabelAlign = 'left' | 'center' | 'right';

const LABEL_ALIGNS: readonly DividerLabelAlign[] = ['left', 'center', 'right'];

function isDividerLabelAlign(value: string): value is DividerLabelAlign {
  return (LABEL_ALIGNS as readonly string[]).includes(value);
}

const ORNAMENT_GLYPH = '❖';
/** The rule character each non-ornament variant draws with. */
const RULE_CHAR: Record<'line' | 'dots', string> = { line: '─', dots: '·' };
/** How much of a labeled rule's rule fill sits on the SHORT side when the label is pushed left/right (the rest fills the long side). */
const SHORT_SIDE_RULE = 2;

/** Builds a full-`width` rule with `label` woven in at `align`, e.g. `── Part 2 ─────────`. */
function labeledRule(
  ruleChar: string,
  label: string,
  width: number,
  align: DividerLabelAlign,
): string {
  const labelText = ` ${label} `;
  const remaining = Math.max(0, width - measureWidth(labelText));
  let left: number;
  if (align === 'left') left = Math.min(SHORT_SIDE_RULE, remaining);
  else if (align === 'right')
    left = remaining - Math.min(SHORT_SIDE_RULE, remaining);
  else left = Math.floor(remaining / 2);
  const right = remaining - left;
  return `${ruleChar.repeat(left)}${labelText}${ruleChar.repeat(right)}`;
}

/**
 * `::divider` / `::divider{label="..." variant="line|dots|ornament"
 * label-align="left|center|right"}` — a leaf directive drawing a section
 * break. Unknown/missing `variant` falls back to `line`; unknown/missing
 * `label-align` falls back to `center`. Terminal form: a full-width rule
 * (`─` for `line`, `·` for `dots`) with the label woven into it at
 * `label-align`, or, for `ornament`, no hairline at all — just the `❖` glyph
 * (doubled around the label, when there is one) placed at `label-align`
 * within the width. Dimmed, matching the plain thematic-break rendering.
 *
 * Registered `selfLayout` (`registry.ts`'s `AnsiRegistryEntry.selfLayout`):
 * a full-width rule is ONE long run with no spaces in it, so the generic
 * post-render `applyLayout` narrowing would treat the whole rule as a
 * single over-long "word" and hard-break it — this component instead reads
 * `ctx.layout` and draws its own rule at the resolved width from the start.
 */
const FIT_DEFAULT_WIDTH = 10;

export const Divider: AnsiComponent = ({ attributes, ctx }) => {
  const rawVariant = attributes.variant ?? 'line';
  const variant: DividerVariant = isDividerVariant(rawVariant)
    ? rawVariant
    : 'line';
  const rawLabel = attributes.label ?? null;
  const label = rawLabel ? ctx.text(rawLabel) : null;
  const rawLabelAlign = attributes['label-align'];
  const labelAlign: DividerLabelAlign =
    rawLabelAlign && isDividerLabelAlign(rawLabelAlign)
      ? rawLabelAlign
      : 'center';

  const naturalWidth = label ? measureWidth(label) + 4 : FIT_DEFAULT_WIDTH;
  const width = selfLayoutWidth(ctx.layout, ctx.width, naturalWidth);

  let line: string;
  if (variant === 'ornament') {
    const inner = label
      ? `${ORNAMENT_GLYPH} ${label} ${ORNAMENT_GLYPH}`
      : ORNAMENT_GLYPH;
    line = padText(inner, width, labelAlign);
  } else {
    const ruleChar = RULE_CHAR[variant];
    line = label
      ? labeledRule(ruleChar, label, width, labelAlign)
      : ruleLine(width, ruleChar);
  }

  return selfLayoutAlign(ctx.dim(line), ctx.layout, ctx.width);
};
