import type { ReactElement, ReactNode } from 'react';

/**
 * Why a directive fell back instead of rendering its component:
 *
 * - `unregistered` — no component is registered under the name (docs/spec.md
 *   requirement 3, the original and by far the common case).
 * - `form-mismatch` — a component IS registered, but the directive was
 *   written in a form its kind does not match: a block component written
 *   inline (`:center[x]`). See `render.tsx`'s `isFormMismatch`.
 */
export type DirectiveFallbackReason = 'unregistered' | 'form-mismatch';

export interface UnknownDirectiveProps {
  name: string;
  inline?: boolean;
  reason?: DirectiveFallbackReason;
  children?: ReactNode;
}

/**
 * The label line, worded for `reason` and for the form the directive was
 * actually written in. Kept in one place (rather than inlined into both
 * branches of the component below) so the inline and block fallbacks can
 * never end up saying different things about the same situation.
 *
 * The `unregistered` wording is unchanged and deliberately identical for
 * both forms — "unknown component `x`" is the phrase docs/spec.md
 * requirement 3 has always produced. A `form-mismatch` says which way round
 * the mismatch is, because that is the only actionable part: the fix is to
 * rewrite the directive in the other form, not to install anything.
 */
function fallbackLabel(
  name: string,
  inline: boolean,
  reason: DirectiveFallbackReason,
): ReactNode {
  if (reason === 'form-mismatch') {
    return inline ? (
      <>
        block component <code>{name}</code> written inline
      </>
    ) : (
      <>
        inline component <code>{name}</code> written as a block
      </>
    );
  }
  return (
    <>
      unknown component <code>{name}</code>
    </>
  );
}

/**
 * Fallback for a directive that could not render its component — either
 * because the name is unregistered (docs/spec.md requirement 3) or because
 * the written form does not match the registered component's kind
 * (`reason: 'form-mismatch'`). Never throws; renders a neutral dashed-border
 * box with a label naming the component, and still shows the directive's
 * inner content (already rendered as plain markdown by the pipeline). This
 * is what keeps `.mk.md` tolerant like markdown instead of brittle like code.
 *
 * The `inline` prop picks the ELEMENT, not merely the styling: an inline
 * (text) directive lives inside a paragraph, and a `<div>` there is invalid
 * HTML that every HTML parser silently restructures — it closes the open
 * `<p>` and reopens one after, so the resulting DOM stops matching what the
 * renderer built. The fallback for an inline directive is therefore built
 * from `<span>`s throughout, including its label, so it can nest inside a
 * paragraph as ordinary phrasing content.
 */
export function UnknownDirective({
  name,
  inline = false,
  reason = 'unregistered',
  children,
}: UnknownDirectiveProps): ReactElement {
  // A modifier class, never body text: a stylesheet can tint a mismatch
  // differently from a genuinely missing component, and the two cases stay
  // distinguishable in a DOM snapshot, without the rendered page turning
  // into an error dump (AGENTS.md's cleanliness principle).
  const reasonClass = reason === 'form-mismatch' ? ' mk-unknown--mismatch' : '';

  if (inline) {
    return (
      <span className={`mk-unknown mk-unknown--inline${reasonClass}`}>
        <span className="mk-unknown__label">
          {fallbackLabel(name, true, reason)}
        </span>
        {children}
      </span>
    );
  }

  return (
    <div className={`mk-unknown mk-unknown--block${reasonClass}`}>
      <p className="mk-unknown__label">{fallbackLabel(name, false, reason)}</p>
      {children ? <div className="mk-unknown__content">{children}</div> : null}
    </div>
  );
}
