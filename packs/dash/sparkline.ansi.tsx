import type { AnsiComponentProps } from '@markii/ansi';
import { formatValue, resolveSparkline } from './sparkline.logic';
import { bindingMarker, joinParts } from './terminal-state';

/** The longest the trend is drawn, in cells, on a wide terminal. */
const MAX_CELLS = 40;

/** Picks `cells` points spread evenly across `points`, keeping the first and last. */
function resample(points: readonly number[], cells: number): number[] {
  if (points.length <= cells) return [...points];
  const out: number[] = [];
  for (let i = 0; i < cells; i++) {
    out.push(points[Math.round((i * (points.length - 1)) / (cells - 1))] ?? 0);
  }
  return out;
}

/**
 * Terminal view of `dash_sparkline`: the series as one row of block steps
 * (from `ctx.glyphs.sparkline`, eight steps lowest first), auto-scaled to
 * its own min and max, then the label and the last value. A flat series
 * sits on the middle step. An empty series shows the engine's empty-value
 * glyph, with the binding marker when the binding failed.
 */
export function Sparkline({ attributes, ctx }: AnsiComponentProps): string {
  const model = resolveSparkline({
    attributes,
    data: ctx.data,
    dataStatus: ctx.dataStatus,
    dataError: ctx.dataError,
  });
  const marker = bindingMarker(ctx);

  if (model.points.length === 0) {
    return joinParts([ctx.dim(ctx.glyphs.emptyValue), marker]);
  }

  const steps = [...ctx.glyphs.sparkline];
  const top = steps.length - 1;
  const cells = Math.max(8, Math.min(MAX_CELLS, ctx.width - 24));
  const shown = resample(model.points, cells);
  const min = Math.min(...shown);
  const range = Math.max(...shown) - min;
  const spark = shown
    .map((value) => {
      const level =
        Number.isFinite(range) && range > 0
          ? Math.round(((value - min) / range) * top)
          : Math.floor(top / 2);
      return steps[level] ?? steps[0] ?? '';
    })
    .join('');

  const tail = [
    model.label !== '' ? ctx.style(ctx.text(model.label), '--mk-muted') : '',
    ctx.bold(formatValue(model.last)),
  ]
    .filter((part) => part !== '')
    .join(' ');
  return joinParts([ctx.style(spark, '--mk-accent'), tail, marker]);
}
