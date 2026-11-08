import type { AnsiComponentProps } from '@markii/ansi';
import { bindingMarker } from './terminal-state';
import { resolveStatus, type StatusState } from './status.logic';

const STATE_TOKEN = {
  ok: '--mk-success',
  warn: '--mk-warning',
  down: '--mk-danger',
  unknown: '--mk-muted',
} as const satisfies Record<StatusState, string>;

/**
 * Terminal view of `dash_status`: the state in brackets, tinted, then the
 * label. The state is spelled out (`[ok]`, `[warn]`, `[down]`, `[?]`)
 * because a dot's color is lost with color off. With no label the state
 * word stands in for it, as in the React view.
 */
export function Status({
  attributes,
  children,
  ctx,
}: AnsiComponentProps): string {
  const { state } = resolveStatus({
    attributes,
    data: ctx.data,
    dataStatus: ctx.dataStatus,
    dataError: ctx.dataError,
  });
  const badge = ctx.style(
    `[${state === 'unknown' ? '?' : state}]`,
    STATE_TOKEN[state],
  );
  const label =
    typeof children === 'string' && children !== '' ? children : state;
  const marker = bindingMarker(ctx);
  const suffix = marker !== '' ? ` ${marker}` : '';
  return `${badge} ${label}${suffix}`;
}
