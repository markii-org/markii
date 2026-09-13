/**
 * `vscode`-free UI constants for the `markii.exportHtml` command
 * ("Markii: Export as HTML", GitHub issue #28 slice 1): the save dialog's
 * title, labels, and filter, and the no-document message. These are
 * VS Code presentation only (a save dialog's title bar, its filter list),
 * so they stay here rather than moving with the shared behavior.
 *
 * The exported file's default name, the outcome shape, and the wording for
 * a result message or a diagnostics line moved to `@markii/host` (batch
 * 11): `exportDefaultFileName`, `NoteFileExportOutcome`,
 * `exportResultMessage`, `renderEngineDiagnosticLine`,
 * `imageEmbedDiagnosticLines`, and `exportDiagnosticLines`, matching the
 * same functions `apps/obsidian` and `apps/cli` now call for their own
 * exports so all three hosts cannot drift on this wording.
 *
 * `preview-panel.ts` is wiring only: it finds the active Markii document,
 * reads that note's persisted last-run values out of `workspaceState`,
 * builds the document with `@markii/host`'s `buildNoteExport`, asks where
 * to save, writes the bytes with `vscode.workspace.fs`, and reports the
 * outcome on both of this extension's surfaces (a short message plus a
 * full line on the "Markii" output channel).
 */

/** Shown when the command runs with no Markii document to export. */
export const EXPORT_HTML_NO_DOCUMENT_MESSAGE =
  'Markii: open a .mk.md file to export it as HTML.';

/** The save dialog's title. */
export const EXPORT_HTML_SAVE_DIALOG_TITLE = 'Markii: Export as HTML';

/** The save dialog's confirm button. */
export const EXPORT_HTML_SAVE_LABEL = 'Export';

/** The button on the success message that reveals the written file in the OS file manager. */
export const EXPORT_HTML_REVEAL_LABEL = 'Show in Folder';

/** The save dialog's filter, so the picker defaults to HTML files. */
export const EXPORT_HTML_FILTERS: Readonly<Record<string, readonly string[]>> =
  { HTML: ['html', 'htm'] };
