/**
 * `vscode`-free logic behind the `markii.insertComponent` command ("Markii:
 * Insert Component…", GitHub issue #17, slice 1): shapes `@markii/host`'s
 * `InsertableComponent` catalog into quick-pick items and owns every
 * user-facing string the command produces — this host's wording home for
 * this command, matching how `./packs/pack-diagnostics.ts` owns pack
 * diagnostic wording and `./packs/export-pack.ts` owns the export command's
 * wording.
 *
 * `extension.ts` (which already imports `vscode`) is wiring only: it finds
 * the active editor, requires it be a previewable Markii/markdown document
 * (`./mark-document.ts`'s `isPreviewableDocument` — see that decision
 * below), discovers configured packs (`./packs/discover-configured-packs.ts`),
 * builds the catalog (`@markii/host`'s `buildComponentCatalog`), shows a
 * quick pick built from this module's items, and on a choice builds the
 * skeleton (`@markii/host`'s `componentSkeleton`) and inserts it.
 */
import type { InsertableComponent } from '@markii/host';

/** Shown when there is no active editor on a document the command is willing to insert into. */
export const NO_ACTIVE_MARK_EDITOR_MESSAGE =
  'Markii: open a .mk.md or Markdown file to insert a component.';

/** The quick-pick title and placeholder for the picker itself. */
export const INSERT_COMPONENT_QUICK_PICK_TITLE = 'Markii: Insert Component';
export const INSERT_COMPONENT_QUICK_PICK_PLACEHOLDER =
  'Choose a component to insert';

/**
 * The quick-pick item shape for one catalog entry, as plain data — no
 * `vscode.QuickPickItem` dependency. `label` is the directive name (what
 * the author types), `description` names the source (`standard`, or
 * `pack "name"` for a pack component), and `detail` is the catalog entry's
 * short description. `extension.ts` builds this list in the same order as
 * the catalog, so the index of the chosen item recovers the matching
 * `InsertableComponent`, exactly like `./packs/export-pack.ts`'s quick pick.
 */
export interface InsertComponentQuickPickItem {
  readonly label: string;
  readonly description: string;
  readonly detail: string;
}

/** `standard`, or `pack "name"` for a pack component. */
function sourceDescription(component: InsertableComponent): string {
  return component.source === 'standard'
    ? 'standard'
    : `pack "${component.packName ?? ''}"`;
}

/** Turns the full insert catalog into quick-pick items, one per entry, in the same order. */
export function insertComponentQuickPickItems(
  catalog: readonly InsertableComponent[],
): readonly InsertComponentQuickPickItem[] {
  return catalog.map((component) => ({
    label: component.directiveName,
    description: sourceDescription(component),
    detail: component.description,
  }));
}
