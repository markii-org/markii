import type { AnsiComponentProps } from '@markii/ansi';
import { resolveQuestion } from './q.logic';
import { tagsLine } from './terminal-level';

/**
 * Terminal view of `prep_q`: the bold question with its level and topic
 * tags, then the answer under an "Answer" line. A terminal note is read
 * once and cannot be clicked, so the answer is not hidden behind a
 * collapsed region the way the React view hides it; it follows the
 * question, marked with the open-fold glyph. With no question there is
 * nothing to hide the body from, so the tags (if any) and the body show.
 */
export function PrepQuestion({
  attributes,
  children,
  ctx,
}: AnsiComponentProps): string {
  const { question, topic, level, hasHead } = resolveQuestion(attributes);
  const lines: string[] = [];
  if (hasHead) {
    const tags = tagsLine(ctx, level, topic);
    lines.push(
      [question !== '' ? ctx.bold(ctx.text(question)) : '', tags]
        .filter((part) => part !== '')
        .join('  '),
    );
  }
  if (question !== '') lines.push(ctx.dim(`${ctx.glyphs.foldOpen} Answer`));
  lines.push(typeof children === 'string' ? children : '');
  return lines.join('\n');
}
