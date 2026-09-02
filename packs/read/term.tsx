import { useId, type ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { strCapped } from './guard';
import './term.css';

const DEF_CAP = 300;

/**
 * `:read_term[monad]{def="..."}`, an inline term. `children` is the term
 * text itself. With a `def`, the term gets a dotted underline, a native
 * `title` tooltip, and a keyboard-reachable definition: `tabIndex={0}`
 * plus `aria-describedby` pointing at a small element carrying the
 * definition text, revealed with CSS `:focus-within` alone (no script
 * state). `useId` keeps the generated id unique per instance without a
 * counter. With no `def`, the term renders with only the underline: no
 * `tabIndex`, no `aria-describedby`, and nothing focusable that would say
 * nothing when reached.
 */
export function Term({
  attributes,
  children,
}: MarkComponentProps): ReactElement {
  const generatedId = useId();
  const def = strCapped(attributes.def, '', DEF_CAP);

  if (def === '') {
    return <span className="mk-read_term mk-read_term--plain">{children}</span>;
  }

  const defId = `mk-read_term-def-${generatedId}`;

  return (
    <span
      className="mk-read_term"
      title={def}
      tabIndex={0}
      aria-describedby={defId}
    >
      {children}
      <span id={defId} role="note" className="mk-read_term__def">
        {def}
      </span>
    </span>
  );
}
