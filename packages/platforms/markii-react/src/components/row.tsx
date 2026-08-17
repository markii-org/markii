import type { ReactElement } from 'react';
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
 */
export function Row({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const rawCols = attributes.cols ?? '';
  const className = isColsValue(rawCols)
    ? `mk-row mk-row--cols-${rawCols}`
    : 'mk-row';

  return <div className={className}>{children}</div>;
}
