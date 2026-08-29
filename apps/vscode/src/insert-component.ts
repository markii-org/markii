/**
 * `vscode`-free logic behind the `markii.insertComponent` command ("Markii:
 * Insert Component…", GitHub issue #17 slice 1, sectioned picker added in
 * issue #18 parts 2 and 3): shapes `@markii/host`'s `InsertableComponent`
 * catalog into quick-pick entries and owns every user-facing string the
 * command produces — this host's wording home for this command, matching
 * how `./packs/pack-diagnostics.ts` owns pack diagnostic wording and
 * `./packs/export-pack.ts` owns the export command's wording.
 *
 * `extension.ts` (which already imports `vscode`) is wiring only: it finds
 * the active editor, requires it be a previewable Markii/markdown document
 * (`./mark-document.ts`'s `isPreviewableDocument` — see that decision
 * below), discovers configured packs (`./packs/discover-configured-packs.ts`),
 * builds the catalog (`@markii/host`'s `buildComponentCatalog`), maps this
 * module's entries onto `vscode.QuickPickItem`s (separators via
 * `vscode.QuickPickItemKind.Separator`), shows the picker, and on a choice
 * builds the skeleton (`@markii/host`'s `componentSkeleton`) and inserts it.
 */
import type { InsertableComponent } from '@markii/host';

/** Shown when there is no active editor on a document the command is willing to insert into. */
export const NO_ACTIVE_MARK_EDITOR_MESSAGE =
  'Markii: open a .mk.md or Markdown file to insert a component.';

/** The quick-pick title and placeholder for the picker itself. */
export const INSERT_COMPONENT_QUICK_PICK_TITLE = 'Markii: Insert Component';
export const INSERT_COMPONENT_QUICK_PICK_PLACEHOLDER =
  'Choose a component to insert';

/** The section separator label for the standard, non-layout components. */
export const STANDARD_SECTION_LABEL = 'Standard';

/** The section separator label for the layout wrappers. */
export const LAYOUT_SECTION_LABEL = 'Layout';

/** The section separator label for one pack's components, e.g. `cat pack`. */
export function packSectionLabel(packName: string): string {
  return `${packName} pack`;
}

/**
 * One row the picker shows, as plain data — no `vscode.QuickPickItem`
 * dependency, so this module stays `vscode`-free. A separator carries only
 * a section label. A component row's `label` is the directive name (what
 * the author types, unchanged by insertion) and `detail` is the row's
 * secondary line. `catalogIndex` is the row's position in the catalog
 * passed to `insertComponentQuickPickItems`, since separators break a plain
 * `items.indexOf(picked)` position mapping — `extension.ts` reads it back
 * to recover the chosen `InsertableComponent`.
 */
export type InsertComponentQuickPickEntry =
  | { readonly kind: 'separator'; readonly label: string }
  | {
      readonly kind: 'component';
      readonly label: string;
      readonly detail: string;
      readonly catalogIndex: number;
    };

/** The section a catalog entry belongs to, for grouping into separators. `pack:<name>` gives each pack its own section. */
function sectionKey(component: InsertableComponent): string {
  if (component.group === 'pack') return `pack:${component.packName ?? ''}`;
  return component.group;
}

function sectionLabel(component: InsertableComponent): string {
  if (component.group === 'standard') return STANDARD_SECTION_LABEL;
  if (component.group === 'layout') return LAYOUT_SECTION_LABEL;
  return packSectionLabel(component.packName ?? '');
}

/**
 * A component row's detail line: for a standard or layout component, the
 * catalog description as-is (empty when the catalog has none). For a pack
 * component, the pack's section label plus its description, e.g.
 * `cat pack - A cat profile card.`, or the section label alone, `cat pack`,
 * when the pack declares no description.
 */
function rowDetail(component: InsertableComponent): string {
  if (component.group !== 'pack') return component.description ?? '';
  const label = packSectionLabel(component.packName ?? '');
  return component.description ? `${label} - ${component.description}` : label;
}

/**
 * Turns the full insert catalog into picker entries: a separator whenever
 * the section changes (so a section with no entries never gets one), then
 * one row per component, in catalog order.
 */
export function insertComponentQuickPickItems(
  catalog: readonly InsertableComponent[],
): readonly InsertComponentQuickPickEntry[] {
  const entries: InsertComponentQuickPickEntry[] = [];
  let currentSection: string | undefined;

  catalog.forEach((component, catalogIndex) => {
    const key = sectionKey(component);
    if (key !== currentSection) {
      currentSection = key;
      entries.push({ kind: 'separator', label: sectionLabel(component) });
    }
    entries.push({
      kind: 'component',
      label: component.directiveName,
      detail: rowDetail(component),
      catalogIndex,
    });
  });

  return entries;
}
