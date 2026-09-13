import { measureWidth, frameBlock, padText } from '../text-grid.js';
import { selfLayoutAlign, selfLayoutWidth } from '../layout.js';
import type { ResolvedLayoutPresets } from '../layout.js';
import {
  childrenText,
  type AnsiComponent,
  type DirectiveAttributes,
} from '../registry.js';

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
type TextAlign = (typeof TEXT_ALIGNS)[number];
function isTextAlign(value: string): value is TextAlign {
  return (TEXT_ALIGNS as readonly string[]).includes(value);
}

/** `width=fit` with no `title` and an unhelpfully-shaped body falls back to this column count rather than the full available width. */
const FIT_DEFAULT_WIDTH = 40;
/** Frame border + one space of interior padding on each side. */
const FRAME_OVERHEAD = 2;

/**
 * The inner budget `card`'s body renders at, given ONLY its own attributes
 * and the outer width — never the body itself. This is deliberately a pure
 * function callable BEFORE any children exist: `render.tsx`'s walk calls it
 * to decide the width its OWN recursive children-builder uses, so `card`'s
 * children are built ONCE, directly at the correct inner width, and never
 * built wide and re-wrapped narrower afterward.
 *
 * That re-wrap-afterward shape was a real, shipped regression (caught
 * post-phase-2 review): re-wrapping an ALREADY-RENDERED child block with a
 * word-based wrapper corrupts anything in it that draws its own fixed-width
 * glyphs (a nested `card`/`callout`'s frame, a nested `row`'s columns) — the
 * word-wrapper has no notion that a run of box-drawing characters is not
 * prose. Computing the inner width eagerly and building children exactly
 * once at it is the fix, and it is what makes the deleted lazy-children API
 * safe to have removed: this is its eager equivalent.
 */
export function resolveCardInnerWidth(
  attributes: DirectiveAttributes,
  layout: ResolvedLayoutPresets | undefined,
  outerWidth: number,
): number {
  const title = attributes.title ?? null;
  const naturalWidth = title
    ? measureWidth(title) + FRAME_OVERHEAD * 2
    : FIT_DEFAULT_WIDTH;
  const boxWidth = selfLayoutWidth(layout, outerWidth, naturalWidth);
  return Math.max(1, boxWidth - FRAME_OVERHEAD);
}

/**
 * `:::card{title="..." text=left|center|right} ... :::` — a titled panel.
 * `title` is optional; the title is woven into the frame's top edge, not a
 * separate line, when given. `text` aligns the body inside the frame;
 * absent/invalid behaves as `left`.
 *
 * Registered `selfLayout` (see `callout.ts`'s doc comment for why): this
 * component draws a real box-drawn frame, which a generic post-render
 * narrow/pad would corrupt, so it reads `ctx.layout` and sizes its own
 * frame. `children` arrives ALREADY built at exactly this component's own
 * inner width (`render.tsx`'s walk calls `resolveCardInnerWidth` above
 * before building them) — this component never re-wraps.
 */
export const Card: AnsiComponent = ({ attributes, children, ctx }) => {
  const title = attributes.title ?? null;
  const titleText = title ? ctx.text(title) : undefined;
  const rawTextAlign = attributes.text;
  const align: TextAlign =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : 'left';

  const naturalWidth = titleText
    ? measureWidth(titleText) + FRAME_OVERHEAD * 2
    : FIT_DEFAULT_WIDTH;
  const boxWidth = selfLayoutWidth(ctx.layout, ctx.width, naturalWidth);
  const innerWidth = Math.max(1, boxWidth - FRAME_OVERHEAD);

  const bodyText = childrenText(children);
  const body =
    align === 'left'
      ? bodyText
      : bodyText
          .split('\n')
          .map((line) => padText(line, innerWidth, align))
          .join('\n');

  const framed = frameBlock(body, {
    style: 'solid',
    title: titleText,
    width: boxWidth,
  });
  return selfLayoutAlign(framed, ctx.layout, ctx.width);
};
