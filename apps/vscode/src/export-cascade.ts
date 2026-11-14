/**
 * `vscode`-free logic behind the `markii.exportHtmlCascade` command
 * ("Markii: Export as HTML cascade", GitHub issue #36): walking the notes a
 * root note links to, exporting each one exactly the way
 * `markii.exportHtml` exports a single note, and packing the results into
 * one zip archive.
 *
 * VS CODE PRESENTATION ONLY. The graph walk, the archive, the outcome
 * shape, and every message and diagnostics line are `@markii/host`'s
 * (`buildCascadeArchive`, `cascadeResultMessage`,
 * `cascadeDiagnosticLines`), shared with the Obsidian plugin so the two
 * hosts cannot drift. What stays here is the save dialog's wording and
 * the default file name.
 */
import { exportBaseName } from '@markii/host/internal';

/** Shown when the command runs with no Markii document to export. */
export const EXPORT_CASCADE_NO_DOCUMENT_MESSAGE =
  'Markii: open a .mk.md file to export it as an HTML cascade.';

/** The save dialog's title. */
export const EXPORT_CASCADE_SAVE_DIALOG_TITLE =
  'Markii: Export as HTML cascade';

/** The save dialog's confirm button. */
export const EXPORT_CASCADE_SAVE_LABEL = 'Export';

/** The save dialog's filter, so the picker defaults to zip archives. */
export const EXPORT_CASCADE_FILTERS: Readonly<
  Record<string, readonly string[]>
> = { 'Zip archive': ['zip'] };

/**
 * The file name the save dialog opens with: the root note's base name with
 * a `.zip` extension, so the archive lands beside the note unless the user
 * navigates elsewhere. Takes the URI *path*, never `fsPath`, exactly like
 * `exportDefaultFileName`.
 */
export function exportCascadeDefaultFileName(uriPath: string): string {
  return `${exportBaseName(uriPath)}.zip`;
}
