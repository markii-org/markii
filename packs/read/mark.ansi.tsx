import type { AnsiComponentProps } from '@markii/ansi';
import { strCapped } from './guard';
import { kindModifier, type MarkKind } from './mark.logic';

const KIND_TOKEN = {
  insight: '--mk-info',
  question: '--mk-warning',
  disagree: '--mk-danger',
  todo: '--mk-success',
} as const satisfies Record<Exclude<MarkKind, 'neutral'>, string>;

/**
 * Terminal view of `read_mark`: the span underlined and tinted with the
 * hue of its kind. A neutral kind is underlined only. With color off the
 * span reads as plain text, the way a highlighter is lost on a printout.
 */
export function Mark({
  attributes,
  children,
  ctx,
}: AnsiComponentProps): string {
  const kind = kindModifier(strCapped(attributes.kind, '', 20));
  const text = ctx.underline(typeof children === 'string' ? children : '');
  return kind === 'neutral' ? text : ctx.style(text, KIND_TOKEN[kind]);
}
