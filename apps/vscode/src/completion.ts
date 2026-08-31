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
import type { CompletionItem, ComponentDocumentation } from '@markii/host';
import {
  LAYOUT_SECTION_LABEL,
  STANDARD_SECTION_LABEL,
} from './insert-component.js';

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
 * The small origin label for a component completion row: `'standard'` or
 * `'layout'` (the same vocabulary `./insert-component.ts`'s picker
 * sections use, lower-cased to read as an inline tag rather than a section
 * heading), or the owning pack's own name for a pack component. Empty
 * string for an attribute or value item, which has no `group`.
 */
export function completionOriginTag(item: CompletionItem): string {
  if (item.kind !== 'component') return '';
  if (item.group === 'standard') return STANDARD_SECTION_LABEL.toLowerCase();
  if (item.group === 'layout') return LAYOUT_SECTION_LABEL.toLowerCase();
  return item.packName ?? '';
}

/**
 * The completion row's secondary line. A component item gets its origin
 * tag, plus the catalog `detail` when there is one (`standard - A colored
 * box for an aside, warning, or danger note.`), or the tag alone when
 * there is no detail. An attribute or value item's `detail` passes through
 * unchanged: slice 1 already wrote that wording (a required marker, an
 * attribute's first sentence).
 */
export function completionItemDetail(item: CompletionItem): string {
  if (item.kind !== 'component') return item.detail;
  const tag = completionOriginTag(item);
  if (item.detail.length === 0) return tag;
  return `${tag} - ${item.detail}`;
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
 * The text VS Code filters a row on, which is NOT always its label.
 *
 * VS Code scores an item's `filterText` (defaulting to its label) against
 * the typed text running from the item's own replace range to the cursor.
 * In a directive-name context that range starts at the COLON RUN, so the
 * typed text is `:::cal` while the label is `callout`: the first character
 * does not match, the fuzzy scorer rejects it, and every component row
 * disappears from a popup that should have been showing them. Prefixing
 * the label with the same colon run makes the two line up again.
 *
 * The colon run is read off the line at `replaceStart` rather than passed
 * in, so this stays a pure string function. An attribute-name or
 * attribute-value range never starts on a colon, and neither does a
 * directive-name range when there is trailing content on the line (that
 * one replaces the bare name), so both simply get the label back.
 */
export function completionFilterText(
  lineText: string,
  replaceStart: number,
  label: string,
): string {
  const colonRun = /^:*/.exec(lineText.slice(replaceStart))?.[0] ?? '';
  return `${colonRun}${label}`;
}
