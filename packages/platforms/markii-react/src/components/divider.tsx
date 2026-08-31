import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry.js';

const DIVIDER_VARIANTS = ['line', 'dots', 'ornament'] as const;
type DividerVariant = (typeof DIVIDER_VARIANTS)[number];
const DEFAULT_VARIANT: DividerVariant = 'line';

const ORNAMENT_GLYPH = '❖';

function isDividerVariant(value: string): value is DividerVariant {
  return (DIVIDER_VARIANTS as readonly string[]).includes(value);
}

function resolveVariant(raw: string | null | undefined): DividerVariant {
  if (raw === null || raw === undefined) return DEFAULT_VARIANT;
  return isDividerVariant(raw) ? raw : DEFAULT_VARIANT;
}

/**
 * `::divider{label="Part 2" variant="dots"}` — a leaf directive drawing a
 * section break. Both attributes are optional: an absent or invalid
 * `variant` quietly falls back to `line` (same posture as `callout`'s
 * `type`), and an absent or empty `label` renders an unlabeled break. A
 * plain `---` thematic break keeps its own CommonMark meaning; this
 * directive exists for a break that carries a label or a chosen look. No outer
 * margin: the document stylesheet (`.doc > * + *`) owns spacing between
 * this and its siblings.
 *
 * `role="separator"` is a leaf ARIA role, so the visible label text is not
 * exposed to assistive tech on its own — `aria-label` carries it instead.
 */
export function Divider({ attributes }: MarkComponentProps): ReactElement {
  const variant = resolveVariant(attributes.variant);
  const label = attributes.label ? attributes.label : null;

  return (
    <div
      className={`mk-divider mk-divider--${variant}`}
      role="separator"
      aria-label={label ?? undefined}
    >
      {variant === 'ornament' ? (
        <span className="mk-divider__ornament" aria-hidden="true">
          {ORNAMENT_GLYPH}
        </span>
      ) : null}
      {label ? <span className="mk-divider__label">{label}</span> : null}
      {variant === 'ornament' && label ? (
        <span className="mk-divider__ornament" aria-hidden="true">
          {ORNAMENT_GLYPH}
        </span>
      ) : null}
    </div>
  );
}
