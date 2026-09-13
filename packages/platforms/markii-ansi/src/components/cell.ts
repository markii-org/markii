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
 * FAITHFULNESS LIMITATION (matches `@markii/html`'s `Tabs`, see that
 * module's doc comment for the same underlying cause): this engine hands a
 * container component its children ALREADY rendered to one flat string, with
 * blank-line-separated blocks joined by a literal double newline —
 * indistinguishable, once flattened, from the double newline `row.ts` uses
 * to tell one cell's rendered block from the next. So a `cell` grouping more
 * than one block COLLAPSES the blank line between its own sub-blocks (they
 * print as adjacent lines instead of separate paragraphs) — the price of
 * leaving `row.ts` an unambiguous cell boundary to split on. A `cell` with a
 * single block is unaffected.
 *
 * `text` aligns this cell's own content when rendered STANDALONE (outside a
 * `row`); nested inside a `row`, the row's own `text` decides every cell's
 * alignment uniformly instead, for the same flattened-text reason `row.ts`
 * cannot see which of its cells set their own override.
 */
export const Cell: AnsiComponent = (attributes, childrenText, ctx) => {
  const rawTextAlign = attributes.text;
  const align: TextAlign | undefined =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : undefined;

  const collapsed = childrenText.replace(/\n{2,}/g, '\n');
  if (!align || align === 'left') return collapsed;
  return collapsed
    .split('\n')
    .map((line) => ctx.pad(line, ctx.width, align))
    .join('\n');
};
