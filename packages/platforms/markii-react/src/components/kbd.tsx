import type { ReactElement } from 'react';
import type { MarkComponentProps } from '../registry.js';

/**
 * `:kbd[Ctrl+S]` — a styled keycap for an inline text directive. Rendered
 * as `inline-block`, baseline-aligned, so it sits inside a line of text
 * without disturbing line height (see doc.css).
 */
export function Kbd({ children }: MarkComponentProps): ReactElement {
  return <kbd className="mk-kbd">{children}</kbd>;
}
