import type { AnsiComponentProps } from '@markii/ansi';
import { CONFIDENCE_SCALE, resolveTopic } from './topic.logic';

// Children arrive rendered, possibly with style escapes; only the visible
// width matters for placing the dots.
const ESCAPES = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Terminal view of `prep_topic`: the topic bold on the left and the
 * confidence as filled and empty stars (`ctx.glyphs.starFilled` and
 * `starEmpty`) on the right edge. A row with no label shows a dim
 * "Untitled topic"; a rating that is not a number omits the stars.
 */
export function PrepTopic({
  attributes,
  children,
  ctx,
}: AnsiComponentProps): string {
  const { name, confidence } = resolveTopic(attributes);
  const written =
    typeof children === 'string' && children.trim() !== '' ? children : '';
  const label =
    written !== ''
      ? ctx.bold(written)
      : name !== ''
        ? ctx.bold(ctx.text(name))
        : ctx.dim('Untitled topic');
  if (confidence === undefined) return label;

  const { starFilled, starEmpty } = ctx.glyphs;
  const stars = `${starFilled.repeat(confidence)}${starEmpty.repeat(CONFIDENCE_SCALE - confidence)}`;
  const used = label.replace(ESCAPES, '').length + CONFIDENCE_SCALE;
  const gap = Math.max(2, ctx.width - used);
  return `${label}${' '.repeat(gap)}${ctx.style(stars, '--mk-accent')}`;
}
