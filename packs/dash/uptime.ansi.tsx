import type { AnsiComponentProps } from '@markii/ansi';
import { resolveUptime, type Segment } from './uptime.logic';
import { bindingMarker, joinParts } from './terminal-state';

const SEGMENT_TOKEN = {
  ok: '--mk-success',
  warn: '--mk-warning',
  down: '--mk-danger',
  unknown: '--mk-muted',
} as const satisfies Record<Segment, string>;

/**
 * Terminal view of `dash_uptime`: the label, one cell per history entry
 * oldest first, then a count line. The cells are the top, middle and
 * bottom steps of `ctx.glyphs.sparkline` for ok, warn and down, so the
 * states stay apart with color off, and the empty-value glyph for an
 * unrecognized entry. A missing or empty history draws one empty cell.
 */
export function Uptime({ attributes, ctx }: AnsiComponentProps): string {
  const model = resolveUptime({
    attributes,
    data: ctx.data,
    dataStatus: ctx.dataStatus,
    dataError: ctx.dataError,
  });
  const steps = [...ctx.glyphs.sparkline];
  const glyphFor: Record<Segment, string> = {
    ok: steps[steps.length - 1] ?? '',
    warn: steps[Math.floor((steps.length - 1) / 2)] ?? '',
    down: steps[0] ?? '',
    unknown: ctx.glyphs.emptyValue,
  };

  const lines: string[] = [];
  if (model.label !== '') {
    lines.push(ctx.style(ctx.text(model.label), '--mk-muted'));
  }

  if (model.segments.length === 0) {
    lines.push(joinParts([ctx.dim(ctx.glyphs.emptyValue), bindingMarker(ctx)]));
    return lines.join('\n');
  }

  lines.push(
    model.segments
      .map((segment) => ctx.style(glyphFor[segment], SEGMENT_TOKEN[segment]))
      .join(''),
  );
  const counts = (['ok', 'warn', 'down'] as const)
    .map((state) => ({
      state,
      n: model.segments.filter((segment) => segment === state).length,
    }))
    .filter(({ n }) => n > 0)
    .map(({ n, state }) => `${String(n)} ${state}`)
    .join(', ');
  lines.push(
    joinParts([
      ctx.dim(
        `${String(model.segments.length)} entries: ${counts || 'none known'}`,
      ),
      bindingMarker(ctx),
    ]),
  );
  return lines.join('\n');
}
