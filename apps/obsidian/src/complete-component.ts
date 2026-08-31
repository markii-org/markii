/**
 * `obsidian`-free logic behind directive autocompletion (GitHub issue #27,
 * slice 3): shapes `@markii/host`'s `CompletionContext`/`CompletionItem`
 * (issue #27 slice 1) into the row shape `./complete-suggest.ts`'s
 * `EditorSuggest` renders, and owns every user-facing string that popup
 * shows. Mirrors `./insert-component.ts`'s split for the Insert Markii
 * component command exactly: this is the wording/shaping home,
 * `./complete-suggest.ts` (which imports `obsidian` for `EditorSuggest`) is
 * wiring only.
 *
 * Reuses `./insert-component.ts`'s origin vocabulary (`STANDARD_ORIGIN`,
 * `LAYOUT_ORIGIN`, and the pack-name-as-origin convention) rather than
 * inventing a second set of words for the same concept, and shares its
 * filter implementation outright (`filterInsertComponentSuggestions`) since
 * the behavior is identical: case-insensitive substring match on `label`,
 * empty query matches everything.
 */
import type { CompletionContext, CompletionItem } from '@markii/host';
import {
  filterSuggestionsByLabel,
  LAYOUT_ORIGIN,
  STANDARD_ORIGIN,
} from './insert-component.js';

/**
 * The small origin tag for a completion item: `standard`, `layout`, or the
 * owning pack's name for a `component` item; the empty string for an
 * `attribute` or `value` item, which has no catalog group of its own.
 */
export function completionOriginTag(item: CompletionItem): string {
  if (item.kind !== 'component') return '';
  if (item.group === 'standard') return STANDARD_ORIGIN;
  if (item.group === 'layout') return LAYOUT_ORIGIN;
  return item.packName ?? '';
}

/**
 * The plain row shape `./complete-suggest.ts`'s `renderSuggestion` draws
 * from: `label` is what the author sees and types against, `origin` is the
 * small tag naming where the item comes from (empty for attribute/value
 * items), and `detail` is the item's own one-line detail text. `detail`
 * never repeats what `origin` already says, matching
 * `InsertComponentSuggestion`'s design.
 */
export interface CompletionSuggestion {
  readonly label: string;
  readonly origin: string;
  readonly detail: string;
  readonly item: CompletionItem;
}

/** Turns a completion context's items into rows, one per item, preserving order. */
export function completionSuggestions(
  context: CompletionContext,
): readonly CompletionSuggestion[] {
  return context.items.map((item) => ({
    label: item.label,
    origin: completionOriginTag(item),
    detail: item.detail,
    item,
  }));
}

/**
 * The text Obsidian's `EditorSuggest` filters rows against, sliced from the
 * context's `replaceStart` to the current cursor column. A directive-name
 * context's `replaceStart` sits at the start of the COLON RUN (`:::`,
 * `::::`, ...), not at the directive name itself — `completionAt` needs the
 * full run to size the replacement correctly — so the raw slice for
 * `:::cal` would filter catalog labels like `callout` against a leading
 * `:::` and match nothing. Any leading colon run is stripped before
 * filtering. Attribute-name and attribute-value contexts have no colons in
 * their range, so the slice is returned unchanged.
 */
export function completionQuery(
  line: string,
  context: CompletionContext,
  column: number,
): string {
  const raw = line.slice(context.replaceStart, column);
  return raw.replace(/^:+/, '');
}

/**
 * Filters completion rows by `query`, case insensitive substring match on
 * `label`. An empty query matches everything. Delegates to
 * `filterSuggestionsByLabel`, the same generic match
 * `filterInsertComponentSuggestions` (`./insert-component.ts`) now uses,
 * rather than re-implementing the same behavior for a second row shape.
 */
export function filterCompletionSuggestions(
  suggestions: readonly CompletionSuggestion[],
  query: string,
): readonly CompletionSuggestion[] {
  return filterSuggestionsByLabel(suggestions, query);
}
