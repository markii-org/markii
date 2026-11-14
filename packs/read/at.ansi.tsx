import type { AnsiComponentProps } from '@markii/ansi';
import { resolveAt } from './at.logic';

const MAX_TEXT_LENGTH = 200;

// A text directive's bracket text arrives here already rendered, as one
// string. The style escapes in it are not the author's words and are
// undone. A colon followed by digits, as in `:read_at[12:34]`, stays plain
// text in the parser, so the timestamp arrives as written.
const SGR = /\x1b\[[0-9;]*m/g;
const OSC8 = /\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;

function recoverText(rendered: string): string {
  return rendered
    .replace(OSC8, '')
    .replace(SGR, '')
    .slice(0, MAX_TEXT_LENGTH)
    .trim();
}

/**
 * Terminal view of `read_at`: the position in brackets, tinted. A safe
 * `href` is printed dim after it with the position already added, since a
 * terminal has no clickable chip.
 */
export function At({ attributes, children, ctx }: AnsiComponentProps): string {
  const text = recoverText(typeof children === 'string' ? children : '');
  const { display, href } = resolveAt(text, attributes);
  const chip = ctx.style(`[${ctx.text(display)}]`, '--mk-accent');
  return href === undefined
    ? chip
    : `${chip}${ctx.dim(` <${ctx.text(href)}>`)}`;
}
