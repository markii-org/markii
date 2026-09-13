import type { AnsiComponent } from '../registry.js';

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
type TextAlign = (typeof TEXT_ALIGNS)[number];
function isTextAlign(value: string): value is TextAlign {
  return (TEXT_ALIGNS as readonly string[]).includes(value);
}

/**
 * `:::cell ... :::` — a transparent grouping container whose only job is
 * letting several blocks count as ONE cell of `:::row`.
 *
 * `row.ts` no longer discovers its cells by splitting a flattened string on
 * a blank-line heuristic: it walks its own directive's top-level children
 * directly (`registry.ts`'s `AnsiChildren.parts`), so a `cell` grouping more
 * than one block renders those blocks exactly as it would standalone,
 * blank line and all, with no collapsing needed to keep a cell boundary
 * unambiguous for `row.ts`.
 *
 * `text` aligns this cell's own content when rendered STANDALONE (outside a
 * `row`); nested inside a `row`, the row's own `text` decides every cell's
 * alignment uniformly instead, for the same reason `row.ts` does not look
 * inside a cell's own attributes when it places columns.
 */
export const Cell: AnsiComponent = (attributes, children, ctx) => {
  const rawTextAlign = attributes.text;
  const align: TextAlign | undefined =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : undefined;

  const childrenText = children();
  if (!align || align === 'left') return childrenText;
  return childrenText
    .split('\n')
    .map((line) => ctx.pad(line, ctx.width, align))
    .join('\n');
};
