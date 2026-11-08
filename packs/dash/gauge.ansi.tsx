import type { AnsiComponentProps } from '@markii/ansi';
import { formatGaugeValue, resolveGauge } from './gauge.logic';
import { bindingMarker, joinParts } from './terminal-state';

/** Cells in the bar, before a narrow terminal shrinks it. */
const BAR_CELLS = 20;

/**
 * Terminal view of `dash_gauge`: the label, a bar filled to the value's
 * place in the range, and the value with its unit. A terminal has no arc,
 * so the arc becomes the bar glyphs `ctx.glyphs` provides.
 */
export function Gauge({ attributes, ctx }: AnsiComponentProps): string {
  const model = resolveGauge({
    attributes,
    data: ctx.data,
    dataStatus: ctx.dataStatus,
    dataError: ctx.dataError,
  });
  const cells = Math.max(5, Math.min(BAR_CELLS, ctx.width - 24));
  const filled = Math.round(model.fraction * cells);
  const { barFilled, barEmpty } = ctx.glyphs;
  const bar = `${ctx.style(barFilled.repeat(filled), '--mk-accent')}${ctx.dim(barEmpty.repeat(cells - filled))}`;
  const label =
    model.label !== '' ? ctx.style(ctx.text(model.label), '--mk-muted') : '';
  return joinParts([
    label,
    bar,
    ctx.bold(`${formatGaugeValue(model.value)}${ctx.text(model.unit)}`),
    bindingMarker(ctx),
  ]);
}
