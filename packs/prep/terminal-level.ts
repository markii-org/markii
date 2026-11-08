import type { AnsiRenderContext } from '@markii/ansi';
import type { LevelTag } from './q.logic';

const LEVEL_TOKEN = {
  easy: '--mk-success',
  medium: '--mk-warning',
  hard: '--mk-danger',
} as const;

/** The level and topic tags of a question as one line of text, or `''`. Shared by `prep_q` and `prep_quiz`. */
export function tagsLine(
  ctx: AnsiRenderContext,
  level: LevelTag,
  topic: string,
): string {
  const parts: string[] = [];
  if (level.text !== '') {
    const text = `[${ctx.text(level.text)}]`;
    parts.push(
      level.modifier === 'easy' ||
        level.modifier === 'medium' ||
        level.modifier === 'hard'
        ? ctx.style(text, LEVEL_TOKEN[level.modifier])
        : ctx.style(text, '--mk-muted'),
    );
  }
  if (topic !== '') parts.push(ctx.style(ctx.text(topic), '--mk-muted'));
  return parts.join(' ');
}
