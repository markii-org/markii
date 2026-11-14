/**
 * `obsidian`-free logic behind the two export commands (GitHub issue #28
 * slice 1): "Export Markii note as HTML" and "Export Markii note as PDF".
 * This module owns the command flow, the outcome shape, the failure
 * classification, and every user-facing string the two commands produce.
 * `main.ts` is wiring only: it finds the active note, reads its text and its
 * last-run values, hands this module a `NoteExportFs` backed by the vault
 * adapter, and shows the `Notice` this module worded.
 *
 * The rendering goes through `@markii/host`'s `buildNoteExport` (GitHub
 * issue #28, slice 2): a host that has React and a loaded pack registry in
 * front of it (`main.ts` wires this from the open preview, or loads one on
 * demand) renders the body itself, so an exported note's pack components
 * are the real components, not the static engine's unknown-component box.
 * A host with no packs loaded, or no renderer to hand over, falls back to
 * `@markii/html`'s static engine, the same document slice 1 produced. This
 * module decides nothing about WHICH engine ran; it only threads
 * `render`, `buildNoteExport`'s account of that choice, into the outcomes
 * this module already reports.
 *
 * THE PDF SEAM. Printing needs Electron, which exists only in a real
 * Obsidian desktop window and cannot be imported under Vitest. So the
 * command takes an `HtmlToPdf` function and knows nothing else about how a
 * PDF is produced (`./export/html-to-pdf.ts` is the one module that touches
 * Electron). Every failure of that function, from "this device has no
 * Electron surface at all" to "printing threw", degrades to writing the
 * HTML file instead — the user always ends up with an exported note.
 */
import { createHtmlExportEngine } from '@markii/host/node';
import {
  createMarkiiHost,
  exportedSiblingPath,
  fileNameOf,
} from '@markii/host';
import type { ExportRequest, HostExportFormat, MarkiiHost } from '@markii/host';
import { createObsidianHostAdapter } from './host-adapter.js';
import type { UnavailableComponent } from '@markii/stdlib';
import type {
  EmbeddedImageReport,
  ExportBodyRenderer,
  ExportImageReader,
  ExportPackStylesheet,
  ExportRenderInfo,
  StaticExportReason,
} from '@markii/host';
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
      /** True when the note contains a script fence. Absent or false means no scripts, so the notice never says to run the note first. */
      readonly hasScripts?: boolean;
      /** Which engine rendered the body, and why when it was the static one. */
      readonly render: ExportRenderInfo;
      /** What image embedding did, for the diagnostics surface. */
      readonly images: EmbeddedImageReport;
    }
  | {
      readonly kind: 'pdf';
      readonly path: string;
      readonly valueCount: number;
      readonly hasScripts?: boolean;
      readonly render: ExportRenderInfo;
      readonly images: EmbeddedImageReport;
    }
  | {
      /** This device cannot print at all; the HTML file was written instead. */
      readonly kind: 'pdf-unavailable';
      readonly path: string;
      readonly valueCount: number;
      readonly reason: string;
      readonly render: ExportRenderInfo;
      readonly images: EmbeddedImageReport;
    }
  | {
      /** Printing was possible but failed this time; the HTML file was written instead. */
      readonly kind: 'pdf-failed';
      readonly path: string;
      readonly valueCount: number;
      readonly reason: string;
      readonly render: ExportRenderInfo;
      readonly images: EmbeddedImageReport;
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
  /**
   * The host's React render of the body, bound to its merged pack
   * registry (`./export/render-body.ts`'s `renderNoteBodyForExport`).
   * Omitted when no packs are loaded, or no renderer is available, in
   * which case `staticReason` says why and the static engine renders
   * instead.
   */
  readonly renderBody?: ExportBodyRenderer;
  /** Why the static engine is used when `renderBody` is omitted. Defaults to `no-packs` in `@markii/host`. */
  readonly staticReason?: StaticExportReason;
  /** The loaded packs' stylesheets, embedded only when `renderBody` actually ran. */
  readonly packStylesheets?: readonly ExportPackStylesheet[];
  /** How many loaded packs contributed components to the registry that rendered this file. Diagnostics only. */
  readonly packCount?: number;
  /** Every installed pack component. The static engine draws no pack views, so each reads "no HTML view" in a statically rendered body. */
  readonly unavailableComponents?: readonly UnavailableComponent[];
  /**
   * Reads one of the note's local images, so the export embeds it as a
   * `data:` URI instead of a vault-relative path (`./export/export-images.ts`,
   * GitHub issue #28 slice 3). Omitted leaves every image source exactly
   * as the author wrote it.
   */
  readonly embedImages?: ExportImageReader;
  /**
   * Hides the collapsed script marker in the exported file, mirroring the
   * "Hide script blocks" setting (`../settings.ts`'s `hideScriptBlocks`)
   * this vault's preview was showing. Defaults to `false`.
   */
  readonly hideScriptBlocks?: boolean;
  /** Where the shared export's own diagnostics lines go. Defaults to the console, this host's diagnostics surface. */
  readonly diagnostics?: (line: string) => void;
}

/** `exportNoteAsPdf`'s extra inputs: the printer, and the folder it may print from. */
export interface NotePdfExportRequest extends NoteExportRequest {
  readonly htmlToPdf: HtmlToPdf;
  /** The note's own folder as an absolute filesystem path, or `undefined` when the vault has none. */
  readonly baseDir: string | undefined;
}

/** The static HTML engine this plugin exports with. */
const htmlEngine = createHtmlExportEngine();

/** The two file extensions this plugin's exports land under, by the shared format name. */
const EXPORT_EXTENSION = { html: '.html', pdf: '.pdf' } as const;

/**
 * The shared host over the vault: `resolveTarget` names the vault-relative
 * file beside the note, and `writeFile` goes through the injected
 * `NoteExportFs`. `printer` is the PDF seam; the host calls it with the
 * finished HTML. Every decision about building the document, and the
 * diagnostics lines for a written file, belong to `@markii/host`.
 */
function exportHost(
  request: NoteExportRequest,
  printer?: (html: string) => Promise<Uint8Array>,
): MarkiiHost {
  const adapter = createObsidianHostAdapter({
    prompt: async () => false,
    loadLocalStorage: () => undefined,
    saveLocalStorage: () => undefined,
    diagnostics: request.diagnostics ?? ((line) => console.log(line)),
    writeFile: async (path, bytes) => {
      if (path.endsWith(EXPORT_EXTENSION.pdf)) {
        await request.fs.writeBinary(path, bytes);
      } else {
        await request.fs.writeText(path, new TextDecoder().decode(bytes));
      }
    },
    exports: {
      formats: new Set<HostExportFormat>(printer ? ['html', 'pdf'] : ['html']),
      resolveTarget: async (_suggested, format) =>
        exportedSiblingPath(
          request.notePath,
          format === 'pdf' ? EXPORT_EXTENSION.pdf : EXPORT_EXTENSION.html,
        ),
      ...(printer ? { htmlToPdf: printer } : {}),
    },
  });
  return createMarkiiHost(adapter, { htmlEngine });
}

/** `createMarkiiHost(...).exportNote`'s request for one note, from this plugin's request. */
function hostRequest(
  request: NoteExportRequest,
  format: 'html' | 'pdf',
): ExportRequest {
  return {
    format,
    notePath: request.notePath,
    text: request.text,
    ...(request.values !== undefined ? { values: request.values } : {}),
    ...(request.unavailableComponents !== undefined
      ? { unavailableComponents: request.unavailableComponents }
      : {}),
    ...(request.renderBody !== undefined
      ? { renderBody: request.renderBody }
      : {}),
    ...(request.staticReason !== undefined
      ? { staticReason: request.staticReason }
      : {}),
    ...(request.packStylesheets !== undefined
      ? { packStylesheets: request.packStylesheets }
      : {}),
    ...(request.packCount !== undefined
      ? { packCount: request.packCount }
      : {}),
    ...(request.embedImages !== undefined
      ? { embedImages: request.embedImages }
      : {}),
    ...(request.hideScriptBlocks !== undefined
      ? { hideScriptBlocks: request.hideScriptBlocks }
      : {}),
  };
}

/**
 * Writes the note as one self-contained `.html` file beside itself in the
 * vault, through `createMarkiiHost(...).exportNote`. The exported file keeps
 * the note's own relative image sources, so a sibling file resolves them
 * exactly as the note does. Never throws.
 */
export async function exportNoteAsHtml(
  request: NoteExportRequest,
): Promise<NoteExportOutcome> {
  const outcome = await exportHost(request).exportNote(
    hostRequest(request, 'html'),
  );
  if (outcome.kind === 'exported') {
    return {
      kind: 'html',
      path: outcome.path,
      valueCount: outcome.valueCount,
      ...(outcome.hasScripts !== undefined
        ? { hasScripts: outcome.hasScripts }
        : {}),
      render: outcome.render,
      images: outcome.images,
    };
  }
  return { kind: 'failed', reason: failureReason(outcome) };
}

/** The reason an export outcome other than `exported` carries. */
function failureReason(
  outcome: Exclude<
    Awaited<ReturnType<MarkiiHost['exportNote']>>,
    { kind: 'exported' }
  >,
): string {
  if (outcome.kind === 'failed') return outcome.reason;
  if (outcome.kind === 'cancelled') return 'the export had nowhere to write.';
  return outcome.detail ?? 'this export format is not available.';
}

/**
 * Writes the note as one `.pdf` file beside itself in the vault, printed
 * from exactly the document `exportNoteAsHtml` would have written. The
 * printer is this plugin's own seam, handed to the shared host as the
 * adapter's `htmlToPdf`.
 *
 * DEGRADATION. If the printer is unavailable or throws, this writes the
 * HTML file instead, through the same host, and says which of the two
 * happened, so the user always ends up with an export. Only a failure of
 * THAT fallback write leaves nothing behind, and that is the one outcome
 * reported as an outright failure. A failure before the document existed
 * (the printer never ran) is also an outright failure.
 */
export async function exportNoteAsPdf(
  request: NotePdfExportRequest,
): Promise<NoteExportOutcome> {
  let printed = false;
  let printError: unknown;
  const outcome = await exportHost(request, async (html) => {
    printed = true;
    try {
      return await request.htmlToPdf({ html, baseDir: request.baseDir });
    } catch (error) {
      printError = error;
      throw error;
    }
  }).exportNote(hostRequest(request, 'pdf'));

  if (outcome.kind === 'exported') {
    return {
      kind: 'pdf',
      path: outcome.path,
      valueCount: outcome.valueCount,
      ...(outcome.hasScripts !== undefined
        ? { hasScripts: outcome.hasScripts }
        : {}),
      render: outcome.render,
      images: outcome.images,
    };
  }
  const reason = failureReason(outcome);
  if (!printed) return { kind: 'failed', reason };

  // The printer ran and something after it failed: the PDF write, or the
  // printer itself. Either way the user still gets the HTML.
  const printReason = printError === undefined ? reason : reasonOf(printError);
  const kind =
    printError !== undefined && isPdfUnavailable(printError)
      ? 'pdf-unavailable'
      : 'pdf-failed';
  const fallback = await exportNoteAsHtml(request);
  if (fallback.kind !== 'html') {
    return {
      kind: 'failed',
      reason: `${printReason}; the HTML fallback also failed: ${fallback.kind === 'failed' ? fallback.reason : ''}`,
    };
  }
  return {
    kind,
    path: fallback.path,
    valueCount: fallback.valueCount,
    reason: printReason,
    render: fallback.render,
    images: fallback.images,
  };
}

// `fileNameOf` (the last path segment, for naming a file in a notice) is
// `@markii/host`'s shared one, imported above.

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
    case 'pdf':
      // The run hint only makes sense for a note that HAS scripts to run: a
      // scriptless note has no values to bake in and nothing to be told.
      return outcome.valueCount === 0 && outcome.hasScripts === true
        ? `Markii: exported ${name}. Run the note first if you want its script values in the file.`
        : `Markii: exported ${name}. It sits beside the note in your vault.`;
    case 'pdf-unavailable':
      return `Markii: PDF export is not available on this device. Markii wrote ${name} instead.`;
    case 'pdf-failed':
      return `Markii: the PDF export failed. Markii wrote ${name} instead.`;
    case 'failed':
      return 'Markii: could not export this note. Open the Markii diagnostics for details.';
  }
}

/**
 * The console lines this plugin adds for one outcome, beyond what the shared
 * host already wrote while exporting (the written file, how the body was
 * rendered, what image embedding did, and a failed write). A written file
 * adds none. A PDF that fell back to HTML adds the reason and how to get a
 * PDF. Every failure reaches the console in full, including the reason the
 * notice deliberately omits, so a user can always find out why without
 * opening developer tools on a hunch.
 */
export function exportDiagnosticLines(outcome: NoteExportOutcome): string[] {
  switch (outcome.kind) {
    case 'html':
    case 'pdf':
      return [];
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
