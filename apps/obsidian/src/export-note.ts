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
import {
  MAX_EMBEDDED_IMAGE_BYTES,
  buildNoteExport,
  exportedSiblingPath,
} from '@markii/host';
import type {
  EmbeddedImageReport,
  ExportBodyRenderer,
  ExportImageReader,
  ExportPackStylesheet,
  ExportRenderInfo,
  SkippedImage,
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
      /** Which engine rendered the body, and why when it was the static one. */
      readonly render: ExportRenderInfo;
      /** What image embedding did, for the diagnostics surface. */
      readonly images: EmbeddedImageReport;
    }
  | {
      readonly kind: 'pdf';
      readonly path: string;
      readonly valueCount: number;
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
  /**
   * Reads one of the note's local images, so the export embeds it as a
   * `data:` URI instead of a vault-relative path (`./export/export-images.ts`,
   * GitHub issue #28 slice 3). Omitted leaves every image source exactly
   * as the author wrote it.
   */
  readonly embedImages?: ExportImageReader;
}

/** `exportNoteAsPdf`'s extra inputs: the printer, and the folder it may print from. */
export interface NotePdfExportRequest extends NoteExportRequest {
  readonly htmlToPdf: HtmlToPdf;
  /** The note's own folder as an absolute filesystem path, or `undefined` when the vault has none. */
  readonly baseDir: string | undefined;
}

/** Builds the standalone document for one note. Never throws: `buildNoteExport` classifies a failing `renderBody` and falls back to the static engine rather than propagating. */
async function buildDocument(request: NoteExportRequest): Promise<{
  html: string;
  valueCount: number;
  render: ExportRenderInfo;
  images: EmbeddedImageReport;
}> {
  const values = request.values ?? {};
  const document = await buildNoteExport({
    text: request.text,
    fileName: request.notePath,
    values,
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
  });
  return {
    html: document.html,
    valueCount: document.valueCount,
    render: document.render,
    images: document.images,
  };
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
    const { html, valueCount, render, images } = await buildDocument(request);
    await request.fs.writeText(path, html);
    return { kind: 'html', path, valueCount, render, images };
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
  let render: ExportRenderInfo;
  let images: EmbeddedImageReport;
  try {
    ({ html, valueCount, render, images } = await buildDocument(request));
  } catch (error) {
    return { kind: 'failed', reason: reasonOf(error) };
  }

  try {
    const pdf = await request.htmlToPdf({ html, baseDir: request.baseDir });
    await request.fs.writeBinary(pdfPath, pdf);
    return { kind: 'pdf', path: pdfPath, valueCount, render, images };
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
    return { kind, path: htmlPath, valueCount, reason, render, images };
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
 * `count` plus `noun`, pluralized with a trailing `s`. Every noun this
 * module uses is regular. Exported so `./export/cascade-export.ts` shares
 * the exact wording rather than growing a second copy.
 */
export function countedNoun(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * A byte count in the largest whole unit that keeps at least one
 * significant digit, matching how a file manager sizes a file: `900 B`,
 * `48 KB`, `2.3 MB`. Used only in diagnostics lines, never a notice.
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) {
    return `${kilobytes < 10 ? kilobytes.toFixed(1) : String(Math.round(kilobytes))} KB`;
  }
  const megabytes = kilobytes / 1024;
  return `${megabytes < 10 ? megabytes.toFixed(1) : String(Math.round(megabytes))} MB`;
}

/**
 * The last path segment of an image source as the note wrote it, for
 * naming a skipped image without printing its whole relative path.
 */
function imageFileNameOf(src: string): string {
  const separator = src.lastIndexOf('/');
  return separator === -1 ? src : src.slice(separator + 1);
}

/** One skipped image's diagnostics line, per `SkippedImage.reason`. */
function skippedImageLine(skipped: SkippedImage): string {
  const name = imageFileNameOf(skipped.src);
  switch (skipped.reason) {
    case 'too-large':
      return `Skipped ${name}, its size is ${formatBytes(skipped.byteLength ?? 0)}, over the ${formatBytes(MAX_EMBEDDED_IMAGE_BYTES)} embed limit.`;
    case 'unsupported-type':
      return `Skipped ${name}, its file type is not embedded.`;
    case 'unreadable':
      return skipped.detail
        ? `Skipped ${name}: ${skipped.detail}`
        : `Skipped ${name}, it could not be read.`;
  }
}

/**
 * The diagnostics lines for one export's image embedding: how many images
 * were embedded and the bytes that added, then one line per skipped
 * image. Nothing at all when the note has no local images, per
 * AGENTS.md's rule that a quiet outcome is still a fact to record, not a
 * line to invent.
 */
function imageDiagnosticLines(images: EmbeddedImageReport): string[] {
  const lines: string[] = [];
  if (images.embedded.length > 0) {
    lines.push(
      `Embedded ${countedNoun(images.embedded.length, 'image')}, adding ${formatBytes(images.embeddedBytes)}.`,
    );
  }
  for (const skipped of images.skipped) {
    lines.push(skippedImageLine(skipped));
  }
  return lines;
}

/**
 * The diagnostics line describing which engine rendered an export's body
 * and why, per `ExportRenderInfo` (GitHub issue #28, slice 2). Kept out of
 * `exportNoticeText` on purpose, user-set: the pack-vs-static distinction
 * belongs in the diagnostics surface, not the notice.
 *
 * `no-renderer` and `timeout` are unreachable on this host today, since
 * `main.ts` never hands `buildNoteExport` a `renderBody` without also
 * meaning to use it and the render itself is a plain synchronous call.
 * They are handled anyway so this switch stays exhaustive against
 * `@markii/host`'s `StaticExportReason`.
 */
function renderDiagnosticLine(render: ExportRenderInfo): string {
  if (render.engine === 'react') {
    return `Rendered through the preview's React engine with ${countedNoun(render.packCount, 'pack component')} and ${countedNoun(render.stylesheetCount, 'pack stylesheet')} embedded.`;
  }
  const detail = render.detail ? ` Detail: ${render.detail}` : '';
  switch (render.reason) {
    case 'no-packs':
      return 'Rendered statically because no pack components are loaded, which matches the preview.';
    case 'no-renderer':
      return `Rendered statically because no React renderer was available on this host.${detail}`;
    case 'timeout':
      return `Rendered statically because the React render timed out. Pack components exported as labeled boxes.${detail}`;
    case 'render-failed':
      return `Rendered statically because the React render failed. Pack components exported as labeled boxes.${detail}`;
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
        renderDiagnosticLine(outcome.render),
        ...imageDiagnosticLines(outcome.images),
      ];
    case 'pdf':
      return [
        `Exported ${outcome.path} as PDF with ${String(outcome.valueCount)} stored values baked in.`,
        renderDiagnosticLine(outcome.render),
        ...imageDiagnosticLines(outcome.images),
      ];
    case 'pdf-unavailable':
      return [
        `PDF export is unavailable on this device: ${outcome.reason}`,
        `Wrote ${outcome.path} as HTML instead. Open it in a browser and print from there to get a PDF.`,
        renderDiagnosticLine(outcome.render),
        ...imageDiagnosticLines(outcome.images),
      ];
    case 'pdf-failed':
      return [
        `PDF export failed: ${outcome.reason}`,
        `Wrote ${outcome.path} as HTML instead. Open it in a browser and print from there to get a PDF.`,
        renderDiagnosticLine(outcome.render),
        ...imageDiagnosticLines(outcome.images),
      ];
    case 'failed':
      return [`Export failed: ${outcome.reason}`];
  }
}
