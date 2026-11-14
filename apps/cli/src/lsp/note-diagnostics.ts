/**
 * A note's findings for the language server: the shared validator in
 * `@markii/stdlib`, run over the tree `@markii/core` parses. Nothing here
 * renders, runs a script, or loads pack code, so a finding never depends on
 * which engine would draw the note, and opening a file in an editor cannot
 * execute anything a pack ships. The wording is the validator's.
 *
 * Pack components come from `pack.json` alone, through `packNoteCatalog`.
 */
import { parse } from '@markii/core';
import { buildComponentCatalog, type LoadPacksOutcome } from '@markii/host';
import {
  buildNoteCatalog,
  validateNote,
  type DiagnosticEvent,
  type NoteCatalogEntry,
} from '@markii/stdlib';

/**
 * The catalog the validator checks a note against: the standard set plus
 * every component the installed packs declare, whichever engine each one
 * has a view for. A component of a pack that declares nothing for this
 * host's engine has no manifest entry to read here, so it is named with no
 * form or attribute rules.
 */
export function packNoteCatalog(
  outcome: Extract<LoadPacksOutcome, { kind: 'loaded' }>,
): readonly NoteCatalogEntry[] {
  const declared = buildComponentCatalog(outcome.packs).filter(
    (entry) => entry.source === 'pack',
  );
  const known = new Set(declared.map((entry) => entry.directiveName));
  const nameOnly: NoteCatalogEntry[] = outcome.components
    .filter((component) => !known.has(component.directive))
    .map((component) => ({
      directiveName: component.directive,
      kind: 'container',
      kindDeclared: false,
    }));
  return buildNoteCatalog([...declared, ...nameOnly]);
}

export function noteDiagnostics(
  text: string,
  catalog: readonly NoteCatalogEntry[],
): DiagnosticEvent[] {
  return validateNote(parse(text), catalog);
}
