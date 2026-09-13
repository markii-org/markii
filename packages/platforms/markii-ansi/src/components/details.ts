import { indentBlock, rewrapBlock } from '../box.js';
import type { AnsiComponent } from '../registry.js';

const DEFAULT_TITLE = 'Details';
/** Columns the indent prefix ("  ") consumes from the enclosing width. */
const INDENT_WIDTH = 2;

/**
 * `:::details{title="..." open} ... :::` — a collapsible disclosure. A
 * terminal has no collapse/expand affordance (see `render.ts`'s top comment
 * on interactive components), so this ALWAYS shows the body: the bare
 * `open` attribute instead only changes the marker glyph (`▾` for `open`,
 * `▸` for folded-by-default), a quiet hint at the note's own authored
 * default rather than a control that does anything here. The marker line
 * also names the section a "collapsible section" so a reader understands
 * why they are seeing an indented block with no directive name attached.
 */
export const Details: AnsiComponent = (attributes, childrenText, ctx) => {
  const title = attributes.title ?? DEFAULT_TITLE;
  const open = Object.hasOwn(attributes, 'open');
  const glyph = open ? '▾' : '▸';
  const marker = ctx.dim(
    `${glyph} ${ctx.bold(ctx.text(title))} (collapsible section, shown expanded)`,
  );
  if (!childrenText) return marker;
  const innerWidth = Math.max(1, ctx.width - INDENT_WIDTH);
  const wrapped = rewrapBlock(childrenText, innerWidth);
  return `${marker}\n${indentBlock(wrapped, '  ')}`;
};
