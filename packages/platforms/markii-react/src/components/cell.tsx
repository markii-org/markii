import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry.js';

/**
 * `:::cell ... :::` — a transparent grouping container whose ONLY job is
 * letting several blocks count as ONE cell of `:::row`. A row's cells are
 * its direct block children, so two blocks are two cells; wrapping them in a
 * `cell` makes them one. It also settles a case that is otherwise
 * impossible: markdown merges two adjacent lists into a single list, so two
 * task lists cannot be two row cells on their own — one `cell` around each
 * separates them.
 *
 * Deliberately has no look of its own: a plain `<div class="mk-cell">` with
 * no border, background, padding, or outer margin (Architecture rule 4 —
 * `.doc > * + *` / the `.mk-row` grid gap own the spacing around it). The
 * single `doc.css` rule it carries, `.mk-cell > * + *`, only restores the
 * vertical rhythm BETWEEN its own children, exactly the way
 * `.mk-layout > * + *` does for the layout wrappers: `.doc > * + *` sees the
 * `cell` as one box and never reaches inside it.
 *
 * Deliberately never reads `attributes`: like the layout wrappers, this
 * container has no attribute-bearing form. Writing one anyway
 * (`:::cell{foo=bar}`) is valid directive syntax and is simply never looked
 * at. Never throws, and an empty body is not an error — an empty `<div>`
 * renders fine.
 *
 * Outside a `:::row` it is inert by construction: a plain unstyled `<div>`
 * in normal flow, which is what "transparent" means here.
 */
export function Cell({ children }: MarkComponentProps): ReactElement {
  return <div className="mk-cell">{children}</div>;
}
