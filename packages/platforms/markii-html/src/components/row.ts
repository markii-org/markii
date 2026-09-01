import { withTextClass } from '../layout.js';
import type { HtmlComponent } from '../registry.js';

/** The exact `cols` values that select a fixed-column-count class; anything else degrades to auto-fit. */
const COLS_VALUES = ['2', '3', '4'] as const;

type ColsValue = (typeof COLS_VALUES)[number];

function isColsValue(value: string): value is ColsValue {
  return (COLS_VALUES as readonly string[]).includes(value);
}

/**
 * `:::row{cols=3} ... :::` — docs/format.md's one layout *container*. An
 * absent or invalid `cols` value degrades to plain `mk-row` (auto-fit)
 * rather than an error. `text` (`left | center | right`) aligns the content
 * inside the row's cells, reaching them through ordinary CSS inheritance;
 * the reserved `align` keeps its ordinary meaning of placing the row's own
 * box, which a full-width grid has no room to act on. Matches
 * `@markii/react`'s `Row` markup byte-for-byte so one stylesheet covers both
 * renderers. No outer margin: the document stylesheet owns spacing between
 * this and its siblings.
 */
export const Row: HtmlComponent = (attributes, childrenHtml) => {
  const rawCols = attributes.cols ?? '';
  const className = withTextClass(
    isColsValue(rawCols) ? `mk-row mk-row--cols-${rawCols}` : 'mk-row',
    attributes.text,
  );

  return `<div class="${className}">${childrenHtml}</div>`;
};
