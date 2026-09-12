/**
 * "Insert Component" (GitHub issue #17, slice 1): the PACK-AWARE half of
 * the insert catalog. `@markii/stdlib/editor`'s `standardComponentCatalog`
 * (GitHub issue #41) is the standard-set half — every `@markii/stdlib`
 * standard component, with no dependency on `@markii/pack` at all — and
 * this module composes it with one entry per component every currently
 * discovered pack declares. This split is why `@markii/stdlib` can stay at
 * zero dependencies while a pack-less host (or a third-party editor
 * integration that never imports `@markii/pack`) still gets the full
 * standard-set catalog for free.
 *
 * Host-neutral and pure: no `vscode`, no `obsidian`, no filesystem access
 * of its own (packs are handed in already discovered, via
 * `@markii/host`'s own `discoverPacks`/`DiscoveredPack`).
 *
 * Never throws. A malformed pack (an empty or missing `components` map, or
 * a local name that fails `@markii/pack`'s namespace validation) simply
 * contributes nothing — the same cleanliness posture as `./discover.ts`.
 * A pack component's declared attribute metadata (`pack.json`'s optional
 * `attributes` list, issue #27 slice 4) is carried through untouched;
 * `@markii/pack`'s `packComponents` has already dropped anything malformed
 * in it, so this module never re-validates it.
 */
import { composeDirectiveName, packComponents } from '@markii/pack';
import {
  LAYOUT_WRAPPER_NAMES,
  standardComponentCatalog,
} from '@markii/stdlib/editor';
import type { InsertableComponent } from '@markii/stdlib/editor';
import type { DiscoveredPack } from '../packs/discover.js';

export { LAYOUT_WRAPPER_NAMES };
export type { InsertableComponent };

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
      requiredAttributes: (listing.attributes ?? [])
        .filter((attribute) => attribute.required === true)
        .map((attribute) => attribute.name),
      ...(listing.attributes !== undefined
        ? { attributes: listing.attributes }
        : {}),
      kindDeclared: listing.kind !== undefined,
    });
  }

  return entries;
}

/**
 * Builds the full insert catalog: `@markii/stdlib/editor`'s standard-set
 * list, then each pack's components (in the order `packs` is given, each
 * pack's own local names sorted alphabetically). A host renders a picker's
 * sections straight off this order — standard section, layout section,
 * then one section per pack — without needing to re-sort or re-group the
 * result itself.
 *
 * A pack component whose composed directive name collides with the
 * standard set or with an earlier pack's entry is skipped, so the returned
 * list never has two entries with the same `directiveName`.
 */
export function buildComponentCatalog(
  packs: readonly DiscoveredPack[],
): readonly InsertableComponent[] {
  const standard = standardComponentCatalog();
  const taken = new Set(standard.map((entry) => entry.directiveName));

  const packEntries: InsertableComponent[] = [];
  for (const pack of packs) {
    packEntries.push(...packCatalogEntries(pack, taken));
  }

  return [...standard, ...packEntries];
}
