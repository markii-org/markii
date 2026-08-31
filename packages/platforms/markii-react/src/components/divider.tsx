import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry.js';

const DIVIDER_VARIANTS = ['line', 'dots', 'ornament'] as const;
type DividerVariant = (typeof DIVIDER_VARIANTS)[number];
const DEFAULT_VARIANT: DividerVariant = 'line';

const LABEL_ALIGNS = ['left', 'center', 'right'] as const;
type LabelAlign = (typeof LABEL_ALIGNS)[number];
const DEFAULT_LABEL_ALIGN: LabelAlign = 'center';

const ORNAMENT_GLYPH = '❖';

function isDividerVariant(value: string): value is DividerVariant {
  return (DIVIDER_VARIANTS as readonly string[]).includes(value);
}

function resolveVariant(raw: string | null | undefined): DividerVariant {
  if (raw === null || raw === undefined) return DEFAULT_VARIANT;
  return isDividerVariant(raw) ? raw : DEFAULT_VARIANT;
}

function isLabelAlign(value: string): value is LabelAlign {
  return (LABEL_ALIGNS as readonly string[]).includes(value);
}

/**
 * `label-align` is component-scoped (not the reserved `width`/`align`
 * layout attributes) and controls where the label sits along the rule.
 * Absent, empty, bare-null, or unrecognized falls back to `center` — same
 * degrade-quietly posture as `variant`.
 */
function resolveLabelAlign(raw: string | null | undefined): LabelAlign {
  if (raw === null || raw === undefined || raw === '') {
    return DEFAULT_LABEL_ALIGN;
  }
  return isLabelAlign(raw) ? raw : DEFAULT_LABEL_ALIGN;
}

/**
 * `::divider{label="Part 2" variant="dots" label-align="left"}` — a leaf
 * directive drawing a section break. All attributes are optional: an
 * absent or invalid `variant` quietly falls back to `line` (same posture
 * as `callout`'s `type`), an absent or empty `label` renders an unlabeled
 * break, and an absent or invalid `label-align` falls back to `center`. A
 * plain `---` thematic break keeps its own CommonMark meaning; this
 * directive exists for a break that carries a label or a chosen look. No outer
 * margin: the document stylesheet (`.doc > * + *`) owns spacing between
 * this and its siblings. `label-align` is component-scoped, distinct from
 * the reserved `width`/`align` layout attributes.
 *
 * `role="separator"` is a leaf ARIA role, so the visible label text is not
 * exposed to assistive tech on its own — `aria-label` carries it instead.
 */
export function Divider({ attributes }: MarkComponentProps): ReactElement {
  const variant = resolveVariant(attributes.variant);
  const label = attributes.label ? attributes.label : null;
  const labelAlign = resolveLabelAlign(attributes['label-align']);
  const labelAlignClass =
    labelAlign === 'center' ? '' : ` mk-divider--label-${labelAlign}`;

  return (
    <div
      className={`mk-divider mk-divider--${variant}${labelAlignClass}`}
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
