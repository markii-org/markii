import { indentBlock } from '../text-grid.js';
import { childrenText, type AnsiComponent } from '../registry.js';

const DEFAULT_TITLE = 'Details';
/** Columns the indent prefix ("  ") consumes from the enclosing width. */
export const DETAILS_INDENT_WIDTH = 2;

/**
 * The inner budget `details`'s body renders at, given only the outer width
 * — never the body itself. Mirrors `card.ts`'s `resolveCardInnerWidth`:
 * `render.tsx`'s walk calls this BEFORE building children (for both the
 * STRING-mode fallback below and the real interactive element builder in
 * `details.tsx`), so the body — and anything self-drawing nested inside it
 * — is built exactly once, at the correct width, never re-wrapped
 * afterward.
 */
export function resolveDetailsInnerWidth(outerWidth: number): number {
  return Math.max(1, outerWidth - DETAILS_INDENT_WIDTH);
}

/**
 * The STRING-mode `details` registration (used by `render.tsx`'s registry
 * lookups, and as the fallback rendering when a `details` directive is
 * reached through STRING mode — nested inside a self-drawing container's
 * own body, see `render.tsx`'s top comment). The real Ink/interactive
 * version `render.tsx` builds directly for a `details` reached through
 * ELEMENT mode is `InteractiveDetails` in `./details.tsx`; the two share no
 * code because this one can only ever show the body (a plain string has no
 * expand/collapse affordance), exactly like the pre-Ink engine. `children`
 * arrives ALREADY built at exactly `resolveDetailsInnerWidth`'s width —
 * this component never re-wraps.
 */
export const Details: AnsiComponent = ({ attributes, children, ctx }) => {
  const title = attributes.title ?? DEFAULT_TITLE;
  const open = Object.hasOwn(attributes, 'open');
  const glyph = open ? '▾' : '▸';
  const marker = ctx.dim(
    `${glyph} ${ctx.bold(ctx.text(title))} (collapsible section, shown expanded)`,
  );
  const body = childrenText(children);
  if (!body) return marker;
  return `${marker}\n${indentBlock(body, '  ')}`;
};
