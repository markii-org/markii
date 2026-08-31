/**
 * `obsidian`-free logic behind the two export commands (GitHub issue #28
 * slice 1): "Export Markii note as HTML" and "Export Markii note as PDF".
 * This module owns the command flow, the outcome shape, the failure
 * classification, and every user-facing string the two commands produce.
 * `main.ts` is wiring only: it finds the active note, reads its text and its
 * last-run values, hands this module a `NoteExportFs` backed by the vault
 * adapter, and shows the `Notice` this module worded.
 *
 * The rendering is `@markii/html`'s, reached through `@markii/host`'s
 * `buildNoteHtmlExport` — the same builder the VS Code extension's export
 * command uses, so the two hosts cannot drift on what an exported file
 * contains or what it is called. Nothing is rendered here.
 *
 * THE PDF SEAM. Printing needs Electron, which exists only in a real
 * Obsidian desktop window and cannot be imported under Vitest. So the
 * command takes an `HtmlToPdf` function and knows nothing else about how a
 * PDF is produced (`./export/html-to-pdf.ts` is the one module that touches
 * Electron). Every failure of that function, from "this device has no
 * Electron surface at all" to "printing threw", degrades to writing the
 * HTML file instead — the user always ends up with an exported note.
 */
import { buildNoteHtmlExport, exportedSiblingPath } from '@markii/host';
import type { StoredValue } from '@markii/runtime';

/** The vault writes an export needs. Backed by Obsidian's `DataAdapter` in `main.ts`; a plain object in tests. */
export interface NoteExportFs {
  /** Writes a UTF-8 text file at a vault-relative path, creating or overwriting it. */
  writeText(path: string, contents: string): Promise<void>;
  /** Writes a binary file at a vault-relative path, creating or overwriting it. */
  writeBinary(path: string, data: Uint8Array): Promise<void>;
}

/** One request to turn a standalone HTML document into PDF bytes. */
export interface HtmlToPdfRequest {
  /** The complete, self-contained HTML document to print. */
  readonly html: string;
  /**
   * An absolute filesystem folder the printer may place a transient source
   * file in, so the printed page resolves the note's relative image paths
   * exactly as the exported HTML does. `undefined` when the vault has no
   * filesystem path, in which case the printer must fail rather than
   * silently print a page with broken images.
   */
  readonly baseDir: string | undefined;
}

/** The injected printer seam. Rejects rather than returning a partial result; every rejection is handled. */
export type HtmlToPdf = (request: HtmlToPdfRequest) => Promise<Uint8Array>;

/**
 * The error an `HtmlToPdf` throws when this device offers no way to print
 * at all — no Electron module, no `BrowserWindow`, no `printToPDF`. Kept
 * distinct from an ordinary printing failure because the two deserve
 * different sentences: one is a property of the install, the other is a
 * thing that went wrong this time.
 */
export class HtmlToPdfUnavailableError extends Error {
  /** Structural marker, so the classification survives an error crossing a module or bundle boundary where `instanceof` can be unreliable. */
  readonly markiiPdfUnavailable = true;

  constructor(message: string) {
    super(message);
    this.name = 'HtmlToPdfUnavailableError';
  }
}

/** True when `error` says PDF export is unavailable on this device, as opposed to having failed this time. */
export function isPdfUnavailable(error: unknown): boolean {
  if (error instanceof HtmlToPdfUnavailableError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { markiiPdfUnavailable?: unknown }).markiiPdfUnavailable === true
  );
}

/** The verbatim reason for a thrown value, for the console. Never shown in a notice. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What one export attempt produced. Every shape except `failed` means the user got a file. */
export type NoteExportOutcome =
  | {
      readonly kind: 'html';
      /** The written file's vault-relative path. */
      readonly path: string;
      /** How many last-run values were baked in. */
      readonly valueCount: number;
    }
  | {
      readonly kind: 'pdf';
      readonly path: string;
      readonly valueCount: number;
    }
  | {
      /** This device cannot print at all; the HTML file was written instead. */
      readonly kind: 'pdf-unavailable';
      readonly path: string;
      readonly valueCount: number;
      readonly reason: string;
    }
  | {
      /** Printing was possible but failed this time; the HTML file was written instead. */
      readonly kind: 'pdf-failed';
      readonly path: string;
      readonly valueCount: number;
      readonly reason: string;
    }
  | {
      /** Nothing was written. */
      readonly kind: 'failed';
      readonly reason: string;
    };

/** What both export commands need. */
export interface NoteExportRequest {
  /** The note's vault-relative, `/`-separated path. */
  readonly notePath: string;
  /** The note's full source text. */
  readonly text: string;
  /** The note's persisted last-run values, baked into the export. Empty means the note has never been run. */
  readonly values?: Record<string, StoredValue>;
  readonly fs: NoteExportFs;
}

/** `exportNoteAsPdf`'s extra inputs: the printer, and the folder it may print from. */
export interface NotePdfExportRequest extends NoteExportRequest {
  readonly htmlToPdf: HtmlToPdf;
  /** The note's own folder as an absolute filesystem path, or `undefined` when the vault has none. */
  readonly baseDir: string | undefined;
}

/** Builds the standalone document for one note. Never throws: the static engine returns its own fallback rather than propagating. */
function buildDocument(request: NoteExportRequest): {
  html: string;
  valueCount: number;
} {
  const values = request.values ?? {};
  const html = buildNoteHtmlExport({
    text: request.text,
    fileName: request.notePath,
    values,
  });
  return { html, valueCount: Object.keys(values).length };
}

/**
 * Writes the note as one self-contained `.html` file beside itself in the
 * vault. The exported file keeps the note's own relative image sources, so
 * a sibling file resolves them exactly as the note does.
 */
export async function exportNoteAsHtml(
  request: NoteExportRequest,
): Promise<NoteExportOutcome> {
  const path = exportedSiblingPath(request.notePath, '.html');
  try {
    const { html, valueCount } = buildDocument(request);
    await request.fs.writeText(path, html);
    return { kind: 'html', path, valueCount };
  } catch (error) {
    return { kind: 'failed', reason: reasonOf(error) };
  }
}

/**
 * Writes the note as one `.pdf` file beside itself in the vault, printed
 * from exactly the document `exportNoteAsHtml` would have written.
 *
 * DEGRADATION. If the printer is unavailable or throws, this writes the
 * HTML file instead and says which of the two happened, so the user always
 * ends up with an export. Only a failure of THAT fallback write leaves
 * nothing behind, and that is the one outcome reported as an outright
 * failure.
 */
export async function exportNoteAsPdf(
  request: NotePdfExportRequest,
): Promise<NoteExportOutcome> {
  const pdfPath = exportedSiblingPath(request.notePath, '.pdf');

  let html: string;
  let valueCount: number;
  try {
    ({ html, valueCount } = buildDocument(request));
  } catch (error) {
    return { kind: 'failed', reason: reasonOf(error) };
  }

  try {
    const pdf = await request.htmlToPdf({ html, baseDir: request.baseDir });
    await request.fs.writeBinary(pdfPath, pdf);
    return { kind: 'pdf', path: pdfPath, valueCount };
  } catch (error) {
    const kind = isPdfUnavailable(error) ? 'pdf-unavailable' : 'pdf-failed';
    const reason = reasonOf(error);
    const htmlPath = exportedSiblingPath(request.notePath, '.html');
    try {
      await request.fs.writeText(htmlPath, html);
    } catch (fallbackError) {
      return {
        kind: 'failed',
        reason: `${reason}; the HTML fallback also failed: ${reasonOf(fallbackError)}`,
      };
    }
    return { kind, path: htmlPath, valueCount, reason };
  }
}

/** The last path segment of a vault-relative path, for naming a file in a notice. */
function fileNameOf(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? path : path.slice(separator + 1);
}

/** Shown when a command runs with no Markii note to export. */
export const NO_ACTIVE_NOTE_NOTICE = 'Markii: open a .mk.md note to export it.';

/**
 * The `Notice` text for one outcome. Notice style, user-set 2026-08-29: at
 * most two short sentences, first what happened, then what it means or what
 * to do. No em dashes, no parentheses; the verbatim reason lives in the
 * console via `exportDiagnosticLines`, never here.
 */
export function exportNoticeText(outcome: NoteExportOutcome): string {
  const name = outcome.kind === 'failed' ? '' : fileNameOf(outcome.path);
  switch (outcome.kind) {
    case 'html':
      return outcome.valueCount === 0
        ? `Markii: exported ${name}. Run the note first if you want its script values in the file.`
        : `Markii: exported ${name}. It sits beside the note in your vault.`;
    case 'pdf':
      return `Markii: exported ${name}. It sits beside the note in your vault.`;
    case 'pdf-unavailable':
      return `Markii: PDF export is not available on this device. Markii wrote ${name} instead.`;
    case 'pdf-failed':
      return `Markii: the PDF export failed. Markii wrote ${name} instead.`;
    case 'failed':
      return 'Markii: could not export this note. Open the Markii diagnostics for details.';
  }
}

/**
 * The console lines for one outcome — this host's diagnostics surface, per
 * docs/integration.md. Every failure reaches here in full, including the
 * reason the notice deliberately omits, so a user can always find out why
 * without opening developer tools on a hunch.
 */
export function exportDiagnosticLines(outcome: NoteExportOutcome): string[] {
  switch (outcome.kind) {
    case 'html':
      return [
        `Exported ${outcome.path} as HTML with ${String(outcome.valueCount)} stored values baked in.`,
      ];
    case 'pdf':
      return [
        `Exported ${outcome.path} as PDF with ${String(outcome.valueCount)} stored values baked in.`,
      ];
    case 'pdf-unavailable':
      return [
        `PDF export is unavailable on this device: ${outcome.reason}`,
        `Wrote ${outcome.path} as HTML instead. Open it in a browser and print from there to get a PDF.`,
      ];
    case 'pdf-failed':
      return [
        `PDF export failed: ${outcome.reason}`,
        `Wrote ${outcome.path} as HTML instead. Open it in a browser and print from there to get a PDF.`,
      ];
    case 'failed':
      return [`Export failed: ${outcome.reason}`];
  }
}
