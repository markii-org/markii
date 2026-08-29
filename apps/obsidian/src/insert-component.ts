/**
 * `obsidian`-free logic behind the "Insert Markii component" command
 * (`insert-markii-component`, GitHub issue #17, slice 1): shapes
 * `@markii/host`'s `InsertableComponent` catalog into suggestion-picker
 * items and owns every user-facing string the command produces — this
 * host's wording home for this command, matching how
 * `./packs/pack-diagnostics.ts` owns pack diagnostic wording.
 *
 * `./insert-modals.ts` (which imports `obsidian` for its `SuggestModal`)
 * and `main.ts` are wiring only: `main.ts` requires an active
 * `MarkdownView` with an editor, discovers configured packs
 * (`./packs/discover-configured-packs.ts`), builds the catalog
 * (`@markii/host`'s `buildComponentCatalog`), shows `./insert-modals.ts`'s
 * picker built from this module's items, and on a choice builds the
 * skeleton (`@markii/host`'s `componentSkeleton`) and inserts it via the
 * Obsidian Editor API.
 */
import type { InsertableComponent } from '@markii/host';

/** Shown (as a Notice) when there is no active Markdown editor to insert into. */
export const NO_ACTIVE_MARK_EDITOR_MESSAGE =
  'Markii: open a Markii or Markdown note to insert a component.';

/** The picker's empty-state text, shown by `SuggestModal` when a filter matches nothing. */
export const NO_MATCHING_COMPONENTS_MESSAGE = 'No matching components.';

/**
 * The suggestion-picker item shape for one catalog entry, as plain data —
 * no `obsidian`-specific type. `label` is the directive name (what the
 * author types), `description` names the source (`standard`, or
 * `pack "name"` for a pack component), and `detail` is the catalog entry's
 * short description.
 */
export interface InsertComponentSuggestion {
  readonly label: string;
  readonly description: string;
  readonly detail: string;
  readonly component: InsertableComponent;
}

/** `standard`, or `pack "name"` for a pack component. */
function sourceDescription(component: InsertableComponent): string {
  return component.source === 'standard'
    ? 'standard'
    : `pack "${component.packName ?? ''}"`;
}

/** Turns the full insert catalog into suggestion items, one per entry, in the same order. */
export function insertComponentSuggestions(
  catalog: readonly InsertableComponent[],
): readonly InsertComponentSuggestion[] {
  return catalog.map((component) => ({
    label: component.directiveName,
    description: sourceDescription(component),
    detail: component.description,
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
