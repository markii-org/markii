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
import { composeDirectiveName } from '@markii/pack';
import type { ComponentKind } from '@markii/stdlib';
import { STANDARD_COMPONENTS } from '@markii/stdlib';
import type { DiscoveredPack } from '../packs/discover.js';

/** One component a picker can offer to insert. */
export interface InsertableComponent {
  /** The directive name the author types, e.g. `callout`, or `cat-card` for a pack component. */
  readonly directiveName: string;
  readonly kind: ComponentKind;
  readonly source: 'standard' | 'pack';
  /** Set only when `source === 'pack'`: the owning pack's namespace. */
  readonly packName?: string;
  /** A short, one-line detail for a picker row. */
  readonly description: string;
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

function standardCatalogEntries(): InsertableComponent[] {
  return Object.entries(STANDARD_COMPONENTS).map(([name, contract]) => ({
    directiveName: name,
    kind: contract.kind,
    source: 'standard',
    description: firstSentence(contract.description),
    requiredAttributes: requiredAttributeNames(contract.attributes),
  }));
}

/**
 * One pack's contribution to the catalog: its `manifest.components` local
 * names, sorted alphabetically for determinism, each composed into a
 * directive name via `@markii/pack`'s `composeDirectiveName`. A local name
 * that fails composition (an invalid namespace or local-name shape) is
 * skipped — never thrown. `taken` is a set of directive names already
 * claimed (by the standard set, or by an earlier pack) that this pack must
 * not collide with; a colliding name is skipped and `taken` is left
 * unchanged for it (first entry keeps the name).
 */
function packCatalogEntries(
  pack: DiscoveredPack,
  taken: Set<string>,
): InsertableComponent[] {
  const components: unknown = pack.manifest.components;
  const localNames =
    typeof components === 'object' && components !== null
      ? Object.keys(components).sort()
      : [];
  const entries: InsertableComponent[] = [];

  for (const localName of localNames) {
    const composed = composeDirectiveName(pack.manifest.name, localName);
    if (!composed.ok) continue;
    if (taken.has(composed.name)) continue;

    taken.add(composed.name);
    entries.push({
      directiveName: composed.name,
      kind: 'container',
      source: 'pack',
      packName: pack.manifest.name,
      description: `From pack "${pack.manifest.name}".`,
      requiredAttributes: [],
    });
  }

  return entries;
}

/**
 * Builds the full insert catalog: the standard set first (declaration
 * order), then each pack's components (in the order `packs` is given,
 * each pack's own local names sorted alphabetically). A pack component
 * whose composed directive name collides with the standard set or with an
 * earlier pack's entry is skipped, so the returned list never has two
 * entries with the same `directiveName`.
 */
export function buildComponentCatalog(
  packs: readonly DiscoveredPack[],
): readonly InsertableComponent[] {
  const standard = standardCatalogEntries();
  const taken = new Set(standard.map((entry) => entry.directiveName));

  const packEntries: InsertableComponent[] = [];
  for (const pack of packs) {
    packEntries.push(...packCatalogEntries(pack, taken));
  }

  return [...standard, ...packEntries];
}
