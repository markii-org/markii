import type { ReactElement } from 'react';
import { withTextClass } from '../layout.js';
import type { MarkComponentProps } from '../registry.js';

/** The exact `cols` values that select a fixed-column-count class; anything else degrades to auto-fit. */
const COLS_VALUES = ['2', '3', '4'] as const;

type ColsValue = (typeof COLS_VALUES)[number];

function isColsValue(value: string): value is ColsValue {
  return (COLS_VALUES as readonly string[]).includes(value);
}

/**
 * `:::row{cols=3} ... :::` — docs/format.md's one layout *container*. Its
 * block children become equal-width cells that wrap responsively and stack
 * on narrow viewports (`doc.css`'s `.mk-row` grid); a plain markdown viewer
 * simply stacks them, since a container directive's inner markdown is
 * always valid CommonMark on its own. No spans, no per-cell sizing — the
 * only knob is `cols`, an exact match of `'2' | '3' | '4'`; an absent or
 * invalid value (`cols=99`, `cols=-1`, `cols=abc`, `cols="2.0"`, `cols=" 2"`)
 * degrades to plain `mk-row` (auto-fit) rather than an error, matching
 * docs/spec.md's "An invalid or absent `cols` degrades to auto-fit, never an
 * error." No outer margin: the document stylesheet (`.doc > * + *`) owns
 * spacing between this and its siblings.
 *
 * `text` (`left | center | right`) aligns the content inside the row's
 * cells. It is a plain per-component attribute, not one of the reserved
 * layout keys: `align` on a row keeps its ordinary meaning of placing the
 * row's own box, which a full-width grid has no room to act on. The cascade
 * into cells is plain CSS inheritance from `.mk-text-*` on the grid itself
 * (`.mk-cell` declares no `text-align` of its own, so nothing blocks it),
 * which is also why a cell's own `text`, or an alignment wrapper written
 * inside a cell, wins without any specificity fight: a declared value
 * always beats an inherited one.
 */
export function Row({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const rawCols = attributes.cols ?? '';
  const className = withTextClass(
    isColsValue(rawCols) ? `mk-row mk-row--cols-${rawCols}` : 'mk-row',
    attributes.text,
  );

  return <div className={className}>{children}</div>;
}
