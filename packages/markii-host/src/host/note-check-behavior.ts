/**
 * The pure half of `checkNote`: the catalog a note is checked against and
 * the validator call. Nothing here reads a file, renders, runs a script or
 * loads pack code, so a finding never depends on which engine would draw the
 * note, and opening a note in an editor cannot execute anything a pack
 * ships. The wording is `@markii/stdlib`'s `validateNote`.
 */
import { isSafeUrl, parse } from '@markii/core';
import {
  buildNoteCatalog,
  standardNoteCatalog,
  validateNote,
  type DiagnosticEvent,
  type NoteCatalogEntry,
  type NoteTreeNode,
  type UnavailableComponent,
} from '@markii/stdlib';
import { buildComponentCatalog } from '../insert/component-catalog.js';
import type { DiscoveredPack } from '../packs/discover.js';

/**
 * The catalog a note is checked against: the standard set plus every
 * component the packs declare, whichever engine each one has a view for. A
 * component with no manifest entry is known by name only, with no form or
 * attribute rules.
 */
export function noteCatalogFromPacks(
  packs: readonly DiscoveredPack[],
  components: readonly UnavailableComponent[],
): readonly NoteCatalogEntry[] {
  const declared = buildComponentCatalog(packs).filter(
    (entry) => entry.source === 'pack',
  );
  const known = new Set(declared.map((entry) => entry.directiveName));
  const nameOnly: NoteCatalogEntry[] = components
    .filter((component) => !known.has(component.directive))
    .map((component) => ({
      directiveName: component.directive,
      kind: 'container',
      kindDeclared: false,
    }));
  return buildNoteCatalog([...declared, ...nameOnly]);
}

/** The standard-set catalog, the fallback when the packs cannot be read. */
export function standardCheckCatalog(): readonly NoteCatalogEntry[] {
  return standardNoteCatalog();
}

/** Parses `text` and validates it against `catalog`, with `@markii/core`'s URL rule. */
export function noteFindings(
  text: string,
  catalog: readonly NoteCatalogEntry[],
): DiagnosticEvent[] {
  // The parsed tree matches `NoteTreeNode` structurally. This package's
  // compile does not load the MDX node types that other workspaces augment
  // into mdast, so the assignment needs the cast here.
  const tree = parse(text) as unknown as NoteTreeNode;
  return validateNote(tree, catalog, { isSafeUrl });
}
