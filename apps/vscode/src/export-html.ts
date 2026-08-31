/**
 * `vscode`-free logic behind the `markii.exportHtml` command
 * ("Markii: Export as HTML", GitHub issue #28 slice 1): the exported file's
 * default name, the outcome shape, and every user-facing string the command
 * produces. This is the command's wording home, matching how
 * `./packs/export-pack.ts` owns the Export Pack command's wording and
 * `./insert-component.ts` owns Insert Component's.
 *
 * `extension.ts` is wiring only: it finds the active Markii document, reads
 * that note's persisted last-run values out of `workspaceState`, builds the
 * document with `@markii/host`'s `buildNoteHtmlExport`, asks where to save,
 * writes the bytes with `vscode.workspace.fs`, and reports the outcome on
 * both of this extension's surfaces (a short message plus a full line on the
 * "Markii" output channel).
 *
 * The rendering itself is `@markii/html`'s, reached through `@markii/host`.
 * Nothing here renders anything.
 */
import { exportedFileName } from '@markii/host';

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

/**
 * The file name the save dialog opens with: the note's own base name with
 * an `.html` extension, so the export lands beside the note unless the user
 * navigates elsewhere. Takes the URI *path* (always `/`-separated), never
 * `fsPath`, so this module needs no `node:path` and no platform branching.
 */
export function exportHtmlDefaultFileName(uriPath: string): string {
  return exportedFileName(uriPath, '.html');
}

/** What one export attempt did, for both the message and the diagnostics line. */
export type HtmlExportOutcome =
  | {
      readonly kind: 'written';
      /** The written file's display path. */
      readonly path: string;
      readonly bytes: number;
      /** How many last-run values were baked into the file. */
      readonly valueCount: number;
    }
  | {
      readonly kind: 'failed';
      /** Where the write was attempted, when it got that far. */
      readonly path?: string;
      /** The verbatim reason. Diagnostics only, never the popup. */
      readonly reason: string;
    };

/** The last path segment of a `/`-separated or `\`-separated path, for naming a file in a message. */
function fileNameOf(path: string): string {
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1] ?? path;
}

/**
 * The short message shown after an export. A success names the file and
 * says whether values were baked in, so a user who exported before running
 * the note is not surprised by empty states in the file. A failure says
 * what failed and points at the diagnostics surface, never at a stack
 * trace: the verbatim reason goes to the output channel instead.
 */
export function exportHtmlResultMessage(outcome: HtmlExportOutcome): string {
  if (outcome.kind === 'failed') {
    return 'Markii: could not export this note as HTML. Open the Markii output for details.';
  }
  const name = fileNameOf(outcome.path);
  if (outcome.valueCount === 0) {
    return `Markii: exported ${name}. The note has no stored script values, so data-bound components show their empty states.`;
  }
  const values =
    outcome.valueCount === 1
      ? '1 script value'
      : `${String(outcome.valueCount)} script values`;
  return `Markii: exported ${name} with ${values} from the last run.`;
}

/**
 * The lines written to the "Markii" output channel for one export — this
 * extension's designated diagnostics surface. Every failure reaches here in
 * full, including the reason the popup deliberately omits.
 */
export function exportHtmlDiagnosticLines(
  outcome: HtmlExportOutcome,
): string[] {
  if (outcome.kind === 'failed') {
    const where = outcome.path ? ` to ${outcome.path}` : '';
    return [`HTML export failed${where}: ${outcome.reason}`];
  }
  return [
    `HTML export wrote ${outcome.path}: ${String(outcome.bytes)} bytes, ${String(outcome.valueCount)} stored values baked in.`,
  ];
}
