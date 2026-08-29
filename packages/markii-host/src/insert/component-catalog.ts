/**
 * "Insert Component" (GitHub issue #17, slice 1): the flat list of
 * components a picker offers — every `@markii/stdlib` standard component,
 * plus one entry per component every currently discovered pack declares.
 * Host-neutral and pure: no `vscode`, no `obsidian`, no filesystem access
 * of its own (packs are handed in already discovered, via
 * `@markii/host`'s own `discoverPacks`/`DiscoveredPack`).
 *
 * Never throws. A malformed pack (an empty or missing `components` map, or
 * a local name that fails `@markii/pack`'s namespace validation) simply
 * contributes nothing — the same cleanliness posture as `./discover.ts`.
 */
import { composeDirectiveName, packComponents } from '@markii/pack';
import type { ComponentKind } from '@markii/stdlib';
import { STANDARD_COMPONENTS } from '@markii/stdlib';
import type { DiscoveredPack } from '../packs/discover.js';

/**
 * The six layout-wrapper container directive names (docs/format.md):
 * alignment (`center`, `left`, `right`) and width presets (`wide`,
 * `narrow`, `full`). `left` is real — it exists in `@markii/stdlib`'s
 * `STANDARD_COMPONENTS` alongside the other five — even though issue #18's
 * prose names only five; this constant is the complete, executable set, so
 * a picker's "layout" section can never silently drop or gain a member as
 * the standard set evolves. Exported so a picker UI can render this group
 * under its own heading without hand-copying the name list, and so the
 * colocated test below can assert it stays in sync with
 * `STANDARD_COMPONENTS`.
 */
export const LAYOUT_WRAPPER_NAMES: readonly string[] = [
  'center',
  'left',
  'right',
  'wide',
  'narrow',
  'full',
];

/** One component a picker can offer to insert. */
export interface InsertableComponent {
  /** The directive name the author types, e.g. `callout`, or `cat_card` for a pack component. */
  readonly directiveName: string;
  readonly kind: ComponentKind;
  readonly source: 'standard' | 'pack';
  /**
   * Which section of a picker this entry belongs in: the ordinary standard
   * set, the layout-wrapper set (also `source: 'standard'`, since a layout
   * wrapper IS a standard component — `group` is the finer split a picker
   * UI wants), or a pack's own contribution.
   */
  readonly group: 'standard' | 'layout' | 'pack';
  /** Set only when `source === 'pack'`: the owning pack's namespace. */
  readonly packName?: string;
  /**
   * A short, one-line detail for a picker row, when one is available. RAW
   * material only: a standard component's contract first sentence, or a
   * pack component's manifest-declared `description` — never a composed
   * filler string like `From pack "x".`. A host that wants a fallback line
   * for a pack component with no declared description writes that string
   * itself, in its own wording module (AGENTS.md: hosts own their
   * user-facing strings).
   */
  readonly description?: string;
  /** Required attribute names, in contract-declared order. Always empty for a pack component (see this module's top comment). */
  readonly requiredAttributes: readonly string[];
}

/**
 * Truncates `description` to its first sentence, for a picker row that has
 * no room for a contract's full prose.
 *
 * A sentence boundary is a period followed by a space AND an uppercase
 * letter, NOT merely ". ". Almost every contract description in
 * `@markii/stdlib` contains "e.g. " before its first real sentence break,
 * and a bare ". " split truncates 19 of the 20 standard components to a
 * row reading "A titled panel, e.g." — the example, which is the useful
 * half, cut off mid-phrase. The uppercase requirement steps over "e.g. `"
 * and "... :::`" alike, because neither is followed by a capital.
 *
 * When no such boundary exists the whole string is returned unchanged: a
 * description that is already one sentence is not worth mangling further.
 */
function firstSentence(description: string): string {
  const boundary = /\.\s+(?=[A-Z])/.exec(description);
  if (boundary === null) return description;
  return description.slice(0, boundary.index + 1);
}

/** Required attribute names off a contract's `attributes` map, in the map's own key order. */
function requiredAttributeNames(
  attributes: Record<string, { required?: boolean }>,
): string[] {
  return Object.keys(attributes).filter(
    (name) => attributes[name]?.required === true,
  );
}

const LAYOUT_WRAPPER_NAME_SET: ReadonlySet<string> = new Set(
  LAYOUT_WRAPPER_NAMES,
);

/**
 * Every standard component (including the layout wrappers), in
 * `STANDARD_COMPONENTS`'s own declaration order. `buildComponentCatalog`
 * below re-splits this into the non-layout entries followed by the layout
 * entries; since the layout wrappers already sit last in
 * `STANDARD_COMPONENTS`'s declaration order, that re-split does not change
 * the overall order today — it exists so the two groups can be labeled and
 * rendered as separate picker sections without relying on that
 * coincidence continuing to hold as the standard set grows.
 */
function standardCatalogEntries(): InsertableComponent[] {
  return Object.entries(STANDARD_COMPONENTS).map(([name, contract]) => ({
    directiveName: name,
    kind: contract.kind,
    source: 'standard',
    group: LAYOUT_WRAPPER_NAME_SET.has(name) ? 'layout' : 'standard',
    description: firstSentence(contract.description),
    requiredAttributes: requiredAttributeNames(contract.attributes),
  }));
}

/**
 * One pack's contribution to the catalog: its declared components
 * (`@markii/pack`'s `packComponents`, sorted alphabetically by local name
 * for determinism), each composed into a directive name via
 * `@markii/pack`'s `composeDirectiveName`. A local name that fails
 * composition (an invalid namespace or local-name shape) is skipped —
 * never thrown. `taken` is a set of directive names already claimed (by
 * the standard set, or by an earlier pack) that this pack must not collide
 * with; a colliding name is skipped and `taken` is left unchanged for it
 * (first entry keeps the name).
 */
function packCatalogEntries(
  pack: DiscoveredPack,
  taken: Set<string>,
): InsertableComponent[] {
  const listings = [...packComponents(pack.manifest)].sort((a, b) =>
    a.localName < b.localName ? -1 : a.localName > b.localName ? 1 : 0,
  );
  const entries: InsertableComponent[] = [];

  for (const listing of listings) {
    const composed = composeDirectiveName(
      pack.manifest.name,
      listing.localName,
    );
    if (!composed.ok) continue;
    if (taken.has(composed.name)) continue;

    taken.add(composed.name);
    entries.push({
      directiveName: composed.name,
      kind: listing.kind ?? 'container',
      source: 'pack',
      group: 'pack',
      packName: pack.manifest.name,
      ...(listing.description !== undefined
        ? { description: listing.description }
        : {}),
      requiredAttributes: [],
    });
  }

  return entries;
}

/**
 * Builds the full insert catalog. Order: every standard, non-layout
 * component first (declaration order), then the six layout wrappers
 * (declaration order), then each pack's components (in the order `packs`
 * is given, each pack's own local names sorted alphabetically). A host
 * renders a picker's sections straight off this order — standard section,
 * layout section, then one section per pack — without needing to re-sort
 * or re-group the result itself.
 *
 * A pack component whose composed directive name collides with the
 * standard set or with an earlier pack's entry is skipped, so the returned
 * list never has two entries with the same `directiveName`.
 */
export function buildComponentCatalog(
  packs: readonly DiscoveredPack[],
): readonly InsertableComponent[] {
  const standardAll = standardCatalogEntries();
  const standard = standardAll.filter((entry) => entry.group === 'standard');
  const layout = standardAll.filter((entry) => entry.group === 'layout');
  const taken = new Set(standardAll.map((entry) => entry.directiveName));

  const packEntries: InsertableComponent[] = [];
  for (const pack of packs) {
    packEntries.push(...packCatalogEntries(pack, taken));
  }

  return [...standard, ...layout, ...packEntries];
}
