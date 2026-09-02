import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { safeHttpUrl, strCapped } from './guard';
import './at.css';

const MAX_TEXT_LENGTH = 200;
const MAX_DEPTH = 6;
const HREF_CAP = 2000;

/**
 * Walks `node` collecting plain text (strings and numbers), recursing into
 * arrays and into an element's own `children` prop, up to `MAX_DEPTH`
 * levels and `budget.remaining` characters. `children` here is rendered
 * React content, not raw markdown, so it can be an arbitrary element tree;
 * this only ever reads `props.children` and `props['data-mk-name']`, never
 * touches an unknown prop, and every branch is a plain type check, so
 * nothing here can throw on its own, but the caller still wraps the whole
 * walk in a try/catch as defense against a future change to this function.
 *
 * One quirk of the format matters here. A colon inside a text directive's
 * bracket text starts ANOTHER text directive, so `:read_at[12:34]` does
 * not parse as the text "12:34": it parses as the text "12" followed by a
 * nested directive named "34". Reading only the strings would silently
 * show "12" and drop half the timestamp, which is exactly the mute
 * failure this project forbids. A directive element carries its written
 * name on `data-mk-name` (the same prop `@markii/react`'s own
 * `readDirectiveChild` reads), so a nested directive is put back as
 * `:<name>` and the timestamp survives. An author can also write
 * `12\:34`, which the parser keeps as literal text; both spellings reach
 * this function as the same string.
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
    const directiveName = props['data-mk-name'];
    if (typeof directiveName === 'string' && directiveName !== '') {
      const piece = `:${directiveName}`.slice(0, budget.remaining);
      out.push(piece);
      budget.remaining -= piece.length;
    }
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
 * Parses `mm:ss`, `m:ss`, or `hh:mm:ss` into total seconds. Every part
 * must be plain digits (no sign, no decimal); seconds and minutes (when a
 * further unit follows) are range-checked to 0..59. Anything else,
 * including an out-of-range part or a huge digit string that overflows to
 * a non-integer `Number`, yields `undefined`.
 */
function parseTimestamp(text: string): number | undefined {
  if (!/^\d+(:\d+){1,2}$/.test(text)) return undefined;
  const parts = text.split(':').map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0))
    return undefined;

  // The regex above fixes the part count at two or three, so each default
  // below is unreachable. They are defaults rather than assertions so the
  // guarantee stays checkable.
  if (parts.length === 2) {
    const [minutes = 0, seconds = 0] = parts;
    if (seconds > 59) return undefined;
    return minutes * 60 + seconds;
  }

  const [hours = 0, minutes = 0, seconds = 0] = parts;
  if (minutes > 59 || seconds > 59) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * A page reference: `42`, `p.42`, `p. 42`, `page 42`, and the capitalized
 * spellings of those. The digits are capped at six, since a longer run is
 * an identifier or a typo rather than a page in a book, and the whole
 * string has to match, so `chapter 4` and `42ff` are not page references.
 */
const PAGE_PATTERN = /^(?:(?:p\.?|page)\s*)?(\d{1,6})$/i;

/**
 * Parses a page reference into its page number, or `undefined` when the
 * text is not one. A timestamp is tried first by the caller, so this never
 * sees text with a colon in it. Page zero is rejected along with the
 * unparseable: there is no such page, and a `#page=0` fragment points a
 * viewer at nothing.
 */
function parsePageRef(text: string): number | undefined {
  const match = PAGE_PATTERN.exec(text);
  if (match === null) return undefined;
  const page = Number(match[1]);
  return Number.isInteger(page) && page >= 1 ? page : undefined;
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
  const display = text !== '' ? text : '--:--';
  const seconds = parseTimestamp(text);
  const page = seconds === undefined ? parsePageRef(text) : undefined;

  const hrefRaw = strCapped(attributes.href, '', HREF_CAP);
  const safeUrl = hrefRaw !== '' ? safeHttpUrl(hrefRaw) : undefined;

  if (safeUrl !== undefined) {
    if (seconds !== undefined) {
      safeUrl.searchParams.set('t', String(seconds));
    } else if (page !== undefined) {
      // Assigning `hash` replaces whatever fragment the href already had,
      // which is what we want: two page anchors on one URL address nothing.
      safeUrl.hash = `page=${String(page)}`;
    }
    return (
      <a className="mk-read_at" href={safeUrl.toString()}>
        {display}
      </a>
    );
  }

  return <span className="mk-read_at">{display}</span>;
}
