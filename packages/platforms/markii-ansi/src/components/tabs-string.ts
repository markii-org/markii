import { childrenText, type AnsiComponent } from '../registry.js';

/** The visible marker appended to whichever tab is treated as "active". */
const ACTIVE_MARKER = ' (active)';

/**
 * The STRING-mode `tabs` registration — the fallback rendering used only
 * when a `tabs` directive is reached through `render.tsx`'s STRING mode
 * (nested inside a self-drawing container) AND, unlike `row`, not
 * reachable through the panel-extraction path there either (both of
 * `render.tsx`'s STRING and ELEMENT dispatchers for `tabs` build panels
 * directly from the hast tree via `extractTabPanels`/`extractTabPanelsElement`
 * rather than calling this component, since only the hast tree — not an
 * already-flattened string — can tell each `tab` child's own `label` apart
 * from its neighbor without a fragile heuristic). This registration exists
 * so the registry always has a real `tabs` component (alias resolution,
 * the contract-drift coverage test, and a caller invoking it directly all
 * see one), using the same blank-line-boundary heuristic the pre-Ink engine
 * used when it has nothing but a flattened string to work with.
 */
export const Tabs: AnsiComponent = ({ children }) => {
  const text = childrenText(children);
  if (!text.trim()) return '';

  const blocks = text.split('\n\n');
  const [first, ...rest] = blocks;
  if (first === undefined) return text;

  const lines = first.split('\n');
  lines[0] = `${lines[0] ?? ''}${ACTIVE_MARKER}`;
  return [lines.join('\n'), ...rest].join('\n\n');
};
