import type { AnsiComponentProps } from '@markii/ansi';
import { strCapped } from './guard';

const DEF_CAP = 300;

/**
 * Terminal view of `read_term`: the term underlined, and its definition
 * after it in dim parentheses. A terminal has no tooltip and no focus
 * panel, so the definition is printed where it can be read.
 */
export function Term({
  attributes,
  children,
  ctx,
}: AnsiComponentProps): string {
  const term = typeof children === 'string' ? children : '';
  const def = strCapped(attributes.def, '', DEF_CAP);
  if (def === '') return ctx.underline(term);
  return `${ctx.underline(term)}${ctx.dim(` (${ctx.text(def)})`)}`;
}
