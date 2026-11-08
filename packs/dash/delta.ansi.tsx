import type { AnsiComponentProps } from '@markii/ansi';
import { bindingMarker } from './terminal-state';
import { resolveDelta, type DeltaDirection } from './delta.logic';

const DIRECTION_TOKEN = {
  up: '--mk-success',
  down: '--mk-danger',
  flat: '--mk-muted',
} as const satisfies Record<DeltaDirection, string>;

/**
 * Terminal view of `dash_delta`: the signed change, tinted by direction,
 * then the directive's own text as the label. The sign carries the
 * direction when color is off, so no arrow glyph is drawn.
 */
export function Delta({
  attributes,
  children,
  ctx,
}: AnsiComponentProps): string {
  const model = resolveDelta({
    attributes,
    data: ctx.data,
    dataStatus: ctx.dataStatus,
    dataError: ctx.dataError,
  });
  const value = ctx.style(
    ctx.bold(ctx.text(model.text)),
    DIRECTION_TOKEN[model.direction],
  );
  const label =
    typeof children === 'string' && children !== '' ? ` ${children}` : '';
  const marker = bindingMarker(ctx);
  const suffix = marker !== '' ? ` ${marker}` : '';
  return `${value}${label}${suffix}`;
}
