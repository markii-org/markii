import type { AnsiComponentProps } from '@markii/ansi';
import { resolveQuote } from './quote.logic';

/**
 * Terminal view of `read_quote`: the passage as the engine rendered it,
 * then the citation right-aligned behind a short rule, then the note in
 * the muted tone. The passage is not re-indented: the engine has already
 * wrapped it at this component's full width, so a gutter would push full
 * lines past the edge.
 */
export function Quote({
  attributes,
  children,
  ctx,
}: AnsiComponentProps): string {
  const { citation, note } = resolveQuote(attributes);
  const lines: string[] = [typeof children === 'string' ? children : ''];

  if (citation !== '') {
    const text = `${ctx.glyphs.rule.repeat(2)} ${ctx.text(citation)}`;
    const pad = Math.max(0, ctx.width - text.length);
    lines.push(`${' '.repeat(pad)}${ctx.style(text, '--mk-muted')}`);
  }
  if (note !== '') {
    lines.push(ctx.style(ctx.text(note), '--mk-muted'));
  }
  return lines.join('\n');
}
