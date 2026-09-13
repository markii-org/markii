import { measure } from '../measure.js';
import { selfLayoutAlign, selfLayoutWidth } from '../layout.js';
import type { AnsiComponent } from '../registry.js';

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
type TextAlign = (typeof TEXT_ALIGNS)[number];
function isTextAlign(value: string): value is TextAlign {
  return (TEXT_ALIGNS as readonly string[]).includes(value);
}

/** `width=fit` with no `title` and an unhelpfully-shaped body (nothing to measure a sensible box from) falls back to this column count rather than the full available width. */
const FIT_DEFAULT_WIDTH = 40;
/** Frame border + one space of interior padding on each side. */
const FRAME_OVERHEAD = 2;

/**
 * `:::card{title="..." text=left|center|right} ... :::` — a titled panel.
 * `title` is optional; the title is woven into the frame's top edge, not a
 * separate line, when given. `text` aligns the body inside the frame;
 * absent/invalid behaves as `left`.
 *
 * Registered `selfLayout` (see `callout.ts`'s doc comment for why): this
 * component draws a real box-drawn frame, which a generic post-render
 * narrow/pad would corrupt, so it reads `ctx.layout` and sizes its own frame.
 */
export const Card: AnsiComponent = (attributes, children, ctx) => {
  const title = attributes.title ?? null;
  const titleText = title ? ctx.text(title) : undefined;
  const rawTextAlign = attributes.text;
  const align: TextAlign =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : 'left';

  const naturalWidth = titleText
    ? measure(titleText) + FRAME_OVERHEAD * 2
    : FIT_DEFAULT_WIDTH;
  const boxWidth = selfLayoutWidth(ctx.layout, ctx.width, naturalWidth);
  const innerWidth = Math.max(1, boxWidth - FRAME_OVERHEAD);

  const childrenText = children({ width: innerWidth });
  const body = childrenText
    ? childrenText
        .split('\n')
        .map((line) =>
          align === 'left' ? line : ctx.pad(line, innerWidth, align),
        )
        .join('\n')
    : '';

  const framed = ctx.frame(body, {
    style: 'solid',
    title: titleText,
    width: boxWidth,
  });
  return selfLayoutAlign(framed, ctx.layout, ctx.width);
};
