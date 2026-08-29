/**
 * `obsidian`-free logic behind the "Insert Markii component" command
 * (`insert-markii-component`, GitHub issue #17 slice 1, origin tag added in
 * issue #18 part 2): shapes `@markii/host`'s `InsertableComponent` catalog
 * into suggestion-picker items and owns every user-facing string the
 * command produces — this host's wording home for this command, matching
 * how `./packs/pack-diagnostics.ts` owns pack diagnostic wording.
 *
 * `./insert-modals.ts` (which imports `obsidian` for its `SuggestModal`)
 * and `main.ts` are wiring only: `main.ts` requires an active
 * `MarkdownView` with an editor, discovers configured packs
 * (`./packs/discover-configured-packs.ts`), builds the catalog
 * (`@markii/host`'s `buildComponentCatalog`), shows `./insert-modals.ts`'s
 * picker built from this module's items, and on a choice builds the
 * skeleton (`@markii/host`'s `componentSkeleton`) and inserts it via the
 * Obsidian Editor API.
 *
 * The picker stays a FLAT fuzzy list by design (no separators, no fake
 * section headers: those fight Obsidian's fuzzy filter). Instead each row
 * carries its own small origin tag alongside the directive name.
 */
import type { InsertableComponent } from '@markii/host';

/** Shown (as a Notice) when there is no active Markdown editor to insert into. */
export const NO_ACTIVE_MARK_EDITOR_MESSAGE =
  'Markii: open a Markii or Markdown note to insert a component.';

/** The picker's empty-state text, shown by `SuggestModal` when a filter matches nothing. */
export const NO_MATCHING_COMPONENTS_MESSAGE = 'No matching components.';

/** The origin tag for a standard, non-layout component. */
export const STANDARD_ORIGIN = 'standard';

/** The origin tag for a layout wrapper. */
export const LAYOUT_ORIGIN = 'layout';

/** The origin tag for a pack component: the pack's own name. */
function packOrigin(component: InsertableComponent): string {
  return component.packName ?? '';
}

/** The small origin tag shown on a row: `standard`, `layout`, or the owning pack's name. */
function originTag(component: InsertableComponent): string {
  if (component.group === 'standard') return STANDARD_ORIGIN;
  if (component.group === 'layout') return LAYOUT_ORIGIN;
  return packOrigin(component);
}

/**
 * The suggestion-picker item shape for one catalog entry, as plain data —
 * no `obsidian`-specific type. `label` is the directive name (what the
 * author types), `origin` is the small tag naming where the component comes
 * from (`standard`, `layout`, or the owning pack's name), and `detail` is
 * the catalog entry's raw description, or an empty string when it declares
 * none. `detail` never repeats what `origin` already says.
 */
export interface InsertComponentSuggestion {
  readonly label: string;
  readonly origin: string;
  readonly detail: string;
  readonly component: InsertableComponent;
}

/** Turns the full insert catalog into suggestion items, one per entry, in the same order. */
export function insertComponentSuggestions(
  catalog: readonly InsertableComponent[],
): readonly InsertComponentSuggestion[] {
  return catalog.map((component) => ({
    label: component.directiveName,
    origin: originTag(component),
    detail: component.description ?? '',
    component,
  }));
}

/**
 * Filters suggestions by `query` against the directive name only (matching
 * `./insert-modals.ts`'s `SuggestModal.getSuggestions` role) — case
 * insensitive substring match. An empty query matches everything.
 */
export function filterInsertComponentSuggestions(
  suggestions: readonly InsertComponentSuggestion[],
  query: string,
): readonly InsertComponentSuggestion[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return suggestions;
  return suggestions.filter((suggestion) =>
    suggestion.label.toLowerCase().includes(needle),
  );
}
