import type { AnsiComponentProps } from '@markii/ansi';
import { resolveSource } from './source.logic';

/** Cells in the progress bar, before a narrow terminal shrinks it. */
const BAR_CELLS = 20;

const STATUS_TOKEN = {
  queued: '--mk-muted',
  reading: '--mk-info',
  done: '--mk-success',
} as const;

/**
 * Terminal view of `read_source`: a badge and bold title, the byline, then
 * one line with the status, a progress bar, and the percentage. All of the
 * deciding (type, status, which progress source wins) is `resolveSource`,
 * shared with the React view. A safe link is printed dim on its own line,
 * since a terminal has no clickable title. A failed binding shows the
 * engine's own quiet marker after the bar; a stale one a dim "(stale)".
 */
export function Source({ attributes, ctx }: AnsiComponentProps): string {
  const model = resolveSource({
    attributes,
    data: ctx.data,
    dataStatus: ctx.dataStatus,
    dataError: ctx.dataError,
  });

  const lines: string[] = [];
  const badgeToken =
    model.typeModifier === 'other' ? '--mk-muted' : '--mk-accent';
  const title =
    model.rawTitle !== ''
      ? ctx.bold(ctx.text(model.displayTitle))
      : ctx.dim(model.displayTitle);
  lines.push(
    `${ctx.style(`[${ctx.text(model.typeLabel)}]`, badgeToken)} ${title}`,
  );

  if (model.byline !== '') {
    lines.push(ctx.style(ctx.text(model.byline), '--mk-muted'));
  }
  if (model.url !== undefined && model.rawTitle !== '') {
    lines.push(ctx.dim(ctx.text(model.url.toString())));
  }

  const parts: string[] = [];
  if (model.status !== undefined && model.statusLabel !== undefined) {
    parts.push(ctx.style(model.statusLabel, STATUS_TOKEN[model.status]));
  }
  if (model.progress !== undefined) {
    const cells = Math.max(5, Math.min(BAR_CELLS, ctx.width - 24));
    const filled = Math.round((model.progress / 100) * cells);
    const { barFilled, barEmpty } = ctx.glyphs;
    parts.push(
      `${ctx.style(barFilled.repeat(filled), '--mk-accent')}${ctx.dim(barEmpty.repeat(cells - filled))} ${String(Math.round(model.progress))}%`,
    );
    if (model.pagesTitle !== undefined) {
      parts.push(ctx.dim(model.pagesTitle));
    }
  }
  const suffix = ctx.dataSuffix?.trim() ?? '';
  if (suffix !== '') parts.push(ctx.dim(suffix));
  if (parts.length > 0) lines.push(parts.join('  '));

  return lines.join('\n');
}
