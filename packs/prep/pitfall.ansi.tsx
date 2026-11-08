import type { AnsiComponentProps } from '@markii/ansi';
import { str } from './guard';

/** Shown when no `title` is written, so the block always says what it is. */
const DEFAULT_TITLE = 'Common mistake';

/**
 * Terminal view of `prep_pitfall`: a bold warning-tinted heading led by
 * the engine's warning icon, then the body. The body is left at the width
 * the engine gave it, so no bar is drawn down its side.
 */
export function PrepPitfall({
  attributes,
  children,
  ctx,
}: AnsiComponentProps): string {
  const title = str(attributes.title, DEFAULT_TITLE);
  const head = ctx.style(
    `${ctx.glyphs.calloutIcons.warning} ${ctx.bold(ctx.text(title))}`,
    '--mk-warning',
  );
  return `${head}\n${typeof children === 'string' ? children : ''}`;
}
