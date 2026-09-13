/**
 * `vscode`-free wording and presentation home for directive completion and
 * hover (GitHub issue #27, slice 2), matching how `./insert-component.ts`
 * owns the Insert Component command's user-facing strings. `@markii/host`'s
 * `completionAt`/`hoverAt` (issue #27 slice 1) decide WHAT completes and
 * WHERE; this module decides how a `CompletionItem`/`ComponentDocumentation`
 * reads once it reaches a person, and how slice 1's plain
 * `insertText`/`insertCursorOffset` convention becomes VS Code snippet
 * source. `extension.ts` (which already imports `vscode`) is wiring only:
 * it maps this module's plain strings onto `vscode.CompletionItem` /
 * `vscode.MarkdownString` / `vscode.SnippetString`.
 */
import type {
  CompletionItem,
  ComponentDocumentation,
} from '@markii/stdlib/editor';
import { completionOriginTag } from '@markii/host';

/**
 * The characters that (re)open the completion popup while typing a
 * directive: `:` starts a directive name, `{` opens the attribute brace,
 * `=` follows an attribute name (about to open its value), `"` opens an
 * attribute value's quote, and a space separates attribute names inside
 * the brace.
 */
export const MARKII_COMPLETION_TRIGGER_CHARACTERS = [
  ':',
  '{',
  '=',
  '"',
  ' ',
] as const;

/**
 * The completion row's secondary text, shown inline beside the label in a
 * narrow column. A component item gets its origin tag ONLY (`standard`,
 * `layout`, or the pack name): the description already lives in the
 * documentation panel, and a sentence beside the label is truncated to a
 * useless stub. An attribute or value item's `detail` passes through
 * unchanged: slice 1 already wrote that wording short (a required marker,
 * an attribute's first sentence).
 */
export function completionItemDetail(item: CompletionItem): string {
  if (item.kind !== 'component') return item.detail;
  return completionOriginTag(item);
}

/**
 * Renders `ComponentDocumentation` as Markdown source for a
 * `vscode.MarkdownString`: the summary as prose, an `Attributes` bullet
 * list when there are any, then the usage example in a fenced code block
 * tagged `markii` (never inline code: directive syntax's colons and braces
 * read badly, and a brace can break inline-code parsing). Any empty
 * section is omitted, the result never ends with a trailing blank line,
 * and all-empty documentation renders to the empty string.
 */
export function completionMarkdown(doc: ComponentDocumentation): string {
  const sections: string[] = [];

  if (doc.summary.length > 0) sections.push(doc.summary);

  if (doc.attributes.length > 0) {
    sections.push(
      ['**Attributes**', ...doc.attributes.map((line) => `- ${line}`)].join(
        '\n',
      ),
    );
  }

  if (doc.example.length > 0) {
    sections.push(['```markii', doc.example, '```'].join('\n'));
  }

  return sections.join('\n\n');
}

/**
 * Turns slice 1's plain `insertText` plus `insertCursorOffset` into VS
 * Code snippet source: the three characters snippet syntax gives special
 * meaning (`\`, `$`, `}`) are escaped first, and `$0` (the final cursor
 * stop) is spliced in at the position the offset maps to AFTER escaping —
 * escaping first and tracking the offset through it is what keeps a `$`
 * appearing before the cursor from shifting `$0` to the wrong place.
 */
export function snippetText(
  insertText: string,
  insertCursorOffset: number,
): string {
  const clampedOffset = Math.max(
    0,
    Math.min(insertCursorOffset, insertText.length),
  );

  let escaped = '';
  let cursorInEscaped = 0;
  for (let i = 0; i < insertText.length; i++) {
    if (i === clampedOffset) cursorInEscaped = escaped.length;
    const ch = insertText[i]!;
    escaped += ch === '\\' || ch === '$' || ch === '}' ? `\\${ch}` : ch;
  }
  if (clampedOffset >= insertText.length) cursorInEscaped = escaped.length;

  return `${escaped.slice(0, cursorInEscaped)}$0${escaped.slice(cursorInEscaped)}`;
}

/**
 * A zero-padded sort key so VS Code's completion list preserves slice 1's
 * catalog order (standard components, then layout wrappers, then pack
 * components, each internally in catalog order) instead of re-sorting
 * alphabetically. Padded to 6 digits, comfortably wider than any catalog
 * this extension will ever build.
 */
export function completionSortText(index: number): string {
  return String(index).padStart(6, '0');
}

/**
 * The text VS Code filters a row on, which is not always its label.
 *
 * VS Code scores an item against the typed text running from the item's
 * own replace range to the cursor. A directive-name context replaces from
 * the COLON RUN, so that typed text is `:::cal` while the label is
 * `callout`: the first character does not match, the fuzzy scorer rejects
 * the row, and a popup that should be full opens empty. Prefixing the
 * label with exactly the span between the replace start and the name token
 * lines the two up again.
 *
 * That span comes from `completionAt`'s own `replaceStart` and `tokenStart`
 * pair, so this no longer re-derives the colon run with a regex of its own.
 * VS Code's insert-and-replace range form cannot carry the two offsets
 * instead: its contract requires the insert range to start at the same
 * position as the replace range, so one range start has to serve both the
 * edit and the filter, and the filter is what gets adjusted here.
 *
 * An attribute-name or attribute-value context has no separate token start,
 * and neither does a directive-name context with trailing content on the
 * line (that one replaces the bare name), so both get the label back.
 */
export function completionFilterText(
  lineText: string,
  replaceStart: number,
  tokenStart: number,
  label: string,
): string {
  return `${lineText.slice(replaceStart, tokenStart)}${label}`;
}
