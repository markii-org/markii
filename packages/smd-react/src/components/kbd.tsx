import type { ReactElement } from 'react';
import type { SmdComponentProps } from '../registry';

/**
 * `:kbd[Ctrl+S]` — a styled keycap for an inline text directive. Rendered
 * as `inline-block`, baseline-aligned, so it sits inside a line of text
 * without disturbing line height (see doc.css).
 */
export function Kbd({ children }: SmdComponentProps): ReactElement {
  return <kbd className="smd-kbd">{children}</kbd>;
}
