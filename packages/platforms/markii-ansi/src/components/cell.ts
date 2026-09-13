import { padText } from '../text-grid.js';
import { childrenText, type AnsiComponent } from '../registry.js';

const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
type TextAlign = (typeof TEXT_ALIGNS)[number];
function isTextAlign(value: string): value is TextAlign {
  return (TEXT_ALIGNS as readonly string[]).includes(value);
}

/**
 * `:::cell ... :::` — a transparent grouping container whose only job is
 * letting several blocks count as ONE cell of `:::row`.
 *
 * `text` aligns this cell's own content when rendered STANDALONE (outside a
 * `row`) or nested inside one: `render.tsx`'s `row` handling still runs
 * each cell through the ordinary directive pipeline (so this component's
 * own alignment applies first), then applies `row`'s OWN `text` uniformly
 * on top — see `components/row.ts`'s doc comment.
 */
export const Cell: AnsiComponent = ({ attributes, children, ctx }) => {
  const rawTextAlign = attributes.text;
  const align: TextAlign | undefined =
    rawTextAlign && isTextAlign(rawTextAlign) ? rawTextAlign : undefined;

  const text = childrenText(children);
  if (!align || align === 'left') return text;
  return text
    .split('\n')
    .map((line) => padText(line, ctx.width, align))
    .join('\n');
};
