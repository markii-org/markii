import type { AnsiComponentProps } from '@markii/ansi';
import { resolveQuiz } from './quiz.logic';
import { tagsLine } from './terminal-level';

/** Greedy word wrap of plain text to `width` columns. */
function wrapPlain(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((w) => w !== '')) {
      if (line !== '' && line.length + 1 + word.length > width) {
        lines.push(line);
        line = word;
      } else {
        line = line === '' ? word : `${line} ${word}`;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Terminal view of `prep_quiz`: a numbered list, each entry the bold
 * question with its tags and the answer indented beneath it under an
 * "Answer" line. The React view hides each answer until clicked; a
 * terminal note is read once, so the answers are printed. With no
 * questions it says so quietly, and a failed binding adds the engine's
 * own marker.
 */
export function PrepQuiz({ ctx }: AnsiComponentProps): string {
  const { items } = resolveQuiz({
    data: ctx.data,
    dataStatus: ctx.dataStatus,
    dataError: ctx.dataError,
  });
  const suffix = ctx.dataSuffix?.trim() ?? '';
  const marker = suffix !== '' ? ctx.dim(suffix) : '';

  if (items.length === 0) {
    return [ctx.dim('No questions collected yet'), marker]
      .filter((part) => part !== '')
      .join('  ');
  }

  const lines: string[] = [];
  const numberWidth = String(items.length).length + 2;
  items.forEach((item, index) => {
    const number = `${String(index + 1)}.`.padEnd(numberWidth);
    const indent = ' '.repeat(numberWidth);
    const question = item.q !== '' ? ctx.text(item.q) : 'Untitled question';
    const room = Math.max(20, ctx.width - numberWidth - 2);
    wrapPlain(question, room).forEach((line, lineIndex) => {
      lines.push(`${lineIndex === 0 ? number : indent}${ctx.bold(line)}`);
    });
    const tags = tagsLine(ctx, item.level, item.topic);
    if (tags !== '') lines.push(`${indent}${tags}`);
    if (item.answer !== '') {
      lines.push(`${indent}${ctx.dim(`${ctx.glyphs.foldOpen} Answer`)}`);
      for (const line of wrapPlain(ctx.text(item.answer), room)) {
        lines.push(`${indent}  ${line}`);
      }
    }
  });
  if (marker !== '') lines.push(marker);
  return lines.join('\n');
}
