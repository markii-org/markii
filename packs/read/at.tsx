import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { resolveAt } from './at.logic';
import './at.css';

const MAX_TEXT_LENGTH = 200;
const MAX_DEPTH = 6;

/**
 * Walks `node` collecting plain text (strings and numbers), recursing into
 * arrays and into an element's own `children` prop, up to `MAX_DEPTH`
 * levels and `budget.remaining` characters. `children` here is rendered
 * React content, not raw markdown, so it can be an arbitrary element tree;
 * this only ever reads `props.children`, never touches an unknown prop, and every branch is a plain type check, so
 * nothing here can throw on its own, but the caller still wraps the whole
 * walk in a try/catch as defense against a future change to this function.
 *
 * A timestamp such as `:read_at[12:34]` reaches this function as the
 * single string "12:34", because the parser keeps a colon followed by a
 * digit as plain text.
 */
function collectText(
  node: ReactNode,
  depth: number,
  budget: { remaining: number },
  out: string[],
): void {
  if (budget.remaining <= 0 || depth > MAX_DEPTH) return;
  if (node === null || node === undefined || typeof node === 'boolean') return;

  if (typeof node === 'string' || typeof node === 'number') {
    const text = String(node);
    const take = text.slice(0, budget.remaining);
    out.push(take);
    budget.remaining -= take.length;
    return;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      if (budget.remaining <= 0) return;
      collectText(child as ReactNode, depth + 1, budget, out);
    }
    return;
  }

  if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    if ('children' in props) {
      collectText(props.children as ReactNode, depth + 1, budget, out);
    }
  }
}

/** Best-effort plain text of `node`, capped in length and depth, never throwing. */
function extractPlainText(node: ReactNode): string {
  try {
    const budget = { remaining: MAX_TEXT_LENGTH };
    const out: string[] = [];
    collectText(node, 0, budget, out);
    return out.join('');
  } catch {
    return '';
  }
}

/**
 * `:read_at[12:34]{href="https://..."}`, a monospace timestamp chip. The
 * bracket text is read back with `extractPlainText`, which rejoins the
 * nested directive the parser makes of a colon (see that function), so a
 * timestamp written the natural way survives. The text is parsed as
 * `mm:ss` or `hh:mm:ss`; an unparseable timestamp still renders (as the
 * literal text, falling back to `--:--` when there is no text at all)
 * since the displayed text is never withheld.
 *
 * A page reference is the other thing people write here: `p. 42`, `p.42`,
 * `page 42`, or a bare `42`. Text that is not a timestamp is tried as one
 * of those, which is unambiguous because a timestamp always has a colon
 * in it and a page reference never does.
 *
 * `href` becomes a link only when it parses as a safe `http:`/`https:`
 * URL. What gets appended to that URL depends on which reading the text
 * produced. A timestamp appends its seconds as `t=<seconds>` in the query
 * string, replacing any existing `t` and preserving the rest. A page
 * reference sets the URL fragment to `#page=42`, the convention a PDF
 * viewer reads, replacing any fragment the `href` already carried. An
 * unsafe or unparseable `href` renders a plain unlinked chip; a safe
 * `href` whose text is neither reading still links, just unannotated. The
 * chip's own text is always what the author wrote, never the rewritten
 * form.
 */
export function At({ attributes, children }: MarkComponentProps): ReactElement {
  const text = extractPlainText(children).trim();
  const { display, href } = resolveAt(text, attributes);

  if (href !== undefined) {
    return (
      <a className="mk-read_at" href={href}>
        {display}
      </a>
    );
  }

  return <span className="mk-read_at">{display}</span>;
}
