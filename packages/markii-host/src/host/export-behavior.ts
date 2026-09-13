/**
 * The `exportNote` behavior: outcome shape, wording, and format gating,
 * merged from `apps/vscode/src/export-html.ts`, the host-neutral half of
 * `apps/obsidian/src/export-note.ts`, and `apps/cli/src/export-note.ts`'s
 * `exportHtml` (survey finding A10, table rows 22/26).
 *
 * `html` and `md-plain` are fully implemented here, over `../export/note-export.js`'s
 * `buildNoteExport` (already host-neutral, already shared) and
 * `./export/md-plain.js`'s `mdPlainFromSource` (moved in this same phase).
 * `ansi` needs an engine this package does not depend on
 * (`@markii/ansi` is deliberately never a `@markii/host` dependency — see
 * AGENTS.md's package boundaries), so it is rendered through the injected
 * `renderAnsi` option; a host that omits it gets `Unsupported`.
 *
 * PDF stays a seam, never an implementation here, exactly as
 * `tmp/W11-adapter-design.md` specifies: this module builds the same HTML
 * document `html` would have written and hands it to
 * `adapter.exports.htmlToPdf`, but the DEGRADE-TO-HTML-ON-FAILURE product
 * behavior Obsidian's own `exportNoteAsPdf` layers on top (falling back to
 * writing the HTML file when printing is unavailable or fails, and
 * reporting which of the two happened) is Obsidian-specific policy about
 * what to do with a seam's failure, not the seam itself — it stays
 * app-side. See `tmp/W11-phase1b.md` for this call.
 *
 * Cascade orchestration (multi-note export, `walkNoteCascade` +
 * `assignCascadeFileNames` + `rewriteCascadeLinks` + `zipExportArchive`)
 * is NOT moved in this pass — see `tmp/W11-phase1b.md`'s deviations
 * section for why, and what Phase 2 (or a follow-up) still needs to do.
 */
import type { StoredValue } from '@markii/runtime';
import {
  buildNoteExport,
  exportedFileName,
  noteHasScripts,
} from '../export/note-export.js';
import type {
  ExportBodyRenderer,
  ExportPackStylesheet,
  ExportRenderInfo,
  StaticExportReason,
} from '../export/note-export.js';
import {
  EMPTY_IMAGE_REPORT,
  MAX_EMBEDDED_IMAGE_BYTES,
} from '../export/image-embed.js';
import type {
  EmbeddedImageReport,
  ExportImageReader,
  SkippedImage,
} from '../export/image-embed.js';
import { mdPlainFromSource } from './export/md-plain.js';
import type { HostAdapter, HostExportFormat, HostLabels } from './adapter.js';

/** The file name an export lands under, by format: the note's own base name with the format's own extension, so the export lands beside the note unless the host's picker says otherwise. */
export function exportDefaultFileName(
  notePath: string,
  format: HostExportFormat,
): string {
  const extension: Record<HostExportFormat, '.html' | '.pdf' | '.txt' | '.md'> =
    {
      html: '.html',
      pdf: '.pdf',
      ansi: '.txt',
      'md-plain': '.md',
    };
  return exportedFileName(notePath, extension[format]);
}

/** What a `'html'` or `'pdf'` export attempt produced. Every shape except `failed` means the host got a file, and every shape but `failed` carries the same diagnostics-facing detail so the two hosts' wording can share it. */
export type NoteFileExportOutcome =
  | {
      readonly kind: 'written';
      readonly path: string;
      readonly bytes: number;
      /** How many last-run values were baked into the file. */
      readonly valueCount: number;
      /** `true` when the note contains a script fence. Absent or `false` means no scripts, so the message never explains an empty state the note cannot have. */
      readonly hasScripts?: boolean;
      /** Which engine rendered the body, and why when it was the static one. Diagnostics-facing only. */
      readonly render: ExportRenderInfo;
      /** What image embedding did. The empty report when the note has no images or none was offered a reader. */
      readonly images: EmbeddedImageReport;
    }
  | {
      readonly kind: 'failed';
      readonly path?: string;
      readonly reason: string;
    };

/** The last path segment of a `/`-separated or `\`-separated path, for naming a file in a message. */
export function fileNameOf(path: string): string {
  const segments = path.split(/[/\\]/);
  return segments[segments.length - 1] ?? path;
}

/**
 * The short result message for a written or failed html/pdf export. A
 * success names the file. A failure says what failed and points at this
 * host's own diagnostics surface (`labels.diagnosticsSurface`), never at
 * a stack trace — the verbatim reason goes there instead.
 */
export function exportResultMessage(
  outcome: NoteFileExportOutcome,
  labels: HostLabels,
): string {
  if (outcome.kind === 'failed') {
    return `Markii: could not export this note. Open ${labels.diagnosticsSurface} for details.`;
  }
  const name = fileNameOf(outcome.path);
  return outcome.valueCount === 0 && outcome.hasScripts === true
    ? `Markii: exported ${name}. The note has no stored script values, so data-bound components show their empty states.`
    : `Markii: exported ${name}.`;
}

/** One diagnostic line describing HOW an export's body was rendered: the pack-vs-static distinction, kept off the result message and put here instead. */
export function renderEngineDiagnosticLine(render: ExportRenderInfo): string {
  if (render.engine === 'react') {
    const packs =
      render.packCount === 1 ? '1 pack' : `${String(render.packCount)} packs`;
    const stylesheets =
      render.stylesheetCount === 1
        ? '1 stylesheet'
        : `${String(render.stylesheetCount)} stylesheets`;
    return `Rendered through the preview's React engine, with ${packs} and ${stylesheets} embedded.`;
  }
  if (render.reason === 'no-packs') {
    return 'Rendered with the static engine because no pack components are loaded, which matches what the preview shows.';
  }
  if (render.reason === 'no-renderer') {
    return 'Rendered with the static engine because a preview panel could not be opened for this note. Pack components exported as labeled boxes; open the preview and export again to include them.';
  }
  if (render.reason === 'timeout') {
    const detail = render.detail ? ` Detail: ${render.detail}` : '';
    return `Rendered with the static engine because the preview did not answer in time. Pack components exported as labeled boxes.${detail}`;
  }
  const detail = render.detail ? ` Detail: ${render.detail}` : '';
  return `Rendered with the static engine because the preview could not render the note. Pack components exported as labeled boxes.${detail}`;
}

/** One skipped image's diagnostics line: which file, and why it kept its original source instead of being embedded. */
function skippedImageLine(skipped: SkippedImage): string {
  if (skipped.reason === 'too-large') {
    const size =
      skipped.byteLength !== undefined
        ? formatByteSize(skipped.byteLength)
        : 'an unknown size';
    return `Skipped ${skipped.src}: ${size}, over the ${formatByteSize(MAX_EMBEDDED_IMAGE_BYTES)} embed limit.`;
  }
  if (skipped.reason === 'unsupported-type') {
    return `Skipped ${skipped.src}: this file type is not supported for embedding.`;
  }
  return `Skipped ${skipped.src}: ${skipped.detail ?? 'the file could not be read'}.`;
}

/** `bytes`, formatted as a human-readable size (`"1.2 KB"`, `"512 bytes"`). */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${String(bytes)} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** The image lines for `exportDiagnosticLines`: how many images were embedded and how many bytes they added, one line per skipped image, and a remote-source count when any sources still reach the network. Empty when a note has no images at all. */
export function imageEmbedDiagnosticLines(
  images: EmbeddedImageReport,
): string[] {
  const lines: string[] = [];
  if (images.embedded.length > 0) {
    const count =
      images.embedded.length === 1
        ? '1 image'
        : `${String(images.embedded.length)} images`;
    lines.push(
      `Embedded ${count}, adding ${formatByteSize(images.embeddedBytes)} to the exported file.`,
    );
  }
  for (const skipped of images.skipped) {
    lines.push(skippedImageLine(skipped));
  }
  if (images.remote > 0) {
    const line =
      images.remote === 1
        ? '1 image source still points at a remote URL and needs network access to load.'
        : `${String(images.remote)} image sources still point at remote URLs and need network access to load.`;
    lines.push(line);
  }
  return lines;
}

/** The full diagnostics-surface detail for one html/pdf export attempt. */
export function exportDiagnosticLines(
  outcome: NoteFileExportOutcome,
): string[] {
  if (outcome.kind === 'failed') {
    const where = outcome.path ? ` to ${outcome.path}` : '';
    return [`Export failed${where}: ${outcome.reason}`];
  }
  return [
    `Export wrote ${outcome.path}: ${String(outcome.bytes)} bytes, ${String(outcome.valueCount)} stored values baked in.`,
    renderEngineDiagnosticLine(outcome.render),
    ...imageEmbedDiagnosticLines(outcome.images),
  ];
}

/** What `exportHtmlDocumentViaAdapter` needs beyond the note's own text and path. */
export interface ExportHtmlDocumentRequest {
  readonly notePath: string;
  readonly text: string;
  readonly values?: Record<string, StoredValue>;
  readonly renderBody?: ExportBodyRenderer;
  readonly staticReason?: StaticExportReason;
  readonly packStylesheets?: readonly ExportPackStylesheet[];
  readonly packCount?: number;
  readonly embedImages?: ExportImageReader;
  readonly hideScriptBlocks?: boolean;
}

/** Builds the standalone HTML document `html` and `pdf` both export, via the shared, already-host-neutral `buildNoteExport`. Never throws: a failing `renderBody` degrades to the static engine rather than propagating. */
export async function buildExportDocument(
  request: ExportHtmlDocumentRequest,
): Promise<{
  html: string;
  valueCount: number;
  hasScripts: boolean;
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
    ...(request.hideScriptBlocks !== undefined
      ? { hideScriptBlocks: request.hideScriptBlocks }
      : {}),
  });
  return {
    html: document.html,
    valueCount: document.valueCount,
    hasScripts: noteHasScripts(request.text),
    render: document.render,
    images: document.images,
  };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Exports one note as `format`, gated on `adapter.exports?.formats`. A
 * format the host has not declared returns `undefined` immediately
 * (`createMarkiiHost`'s `exportNote` turns that into the shared
 * `Unsupported` outcome and writes its own diagnostics line, matching
 * every other capability-gated behavior).
 *
 * `renderAnsi` is required to actually produce an `'ansi'` outcome — a
 * host that offers the `'ansi'` FORMAT capability but passes no renderer
 * is a configuration bug on that host's part, not a Markii user's problem
 * to see, so it also resolves to `undefined` here (never a thrown error)
 * and the caller's `Unsupported` fallback covers it.
 */
export async function exportNoteFileViaAdapter(
  adapter: HostAdapter,
  format: HostExportFormat,
  request: ExportHtmlDocumentRequest,
  renderAnsi?: (text: string) => Promise<string>,
): Promise<NoteFileExportOutcome | undefined> {
  const formats = adapter.exports?.formats;
  if (formats === undefined || !formats.has(format)) return undefined;

  if (format === 'html' || format === 'pdf') {
    try {
      const built = await buildExportDocument(request);
      if (format === 'html') {
        const bytes = new TextEncoder().encode(built.html).byteLength;
        const path = await adapter.exports?.resolveTarget(
          exportDefaultFileName(request.notePath, 'html'),
          'html',
        );
        if (path === undefined) return undefined;
        await adapter.writeFile(path, new TextEncoder().encode(built.html));
        return {
          kind: 'written',
          path,
          bytes,
          valueCount: built.valueCount,
          hasScripts: built.hasScripts,
          render: built.render,
          images: built.images,
        };
      }
      // 'pdf': the seam only. Degradation policy stays app-side.
      const htmlToPdf = adapter.exports?.htmlToPdf;
      if (htmlToPdf === undefined) return undefined;
      const path = await adapter.exports?.resolveTarget(
        exportDefaultFileName(request.notePath, 'pdf'),
        'pdf',
      );
      if (path === undefined) return undefined;
      const pdfBytes = await htmlToPdf(built.html);
      await adapter.writeFile(path, pdfBytes);
      return {
        kind: 'written',
        path,
        bytes: pdfBytes.byteLength,
        valueCount: built.valueCount,
        hasScripts: built.hasScripts,
        render: built.render,
        images: built.images,
      };
    } catch (error) {
      return { kind: 'failed', reason: reasonOf(error) };
    }
  }

  if (format === 'md-plain') {
    try {
      const text = mdPlainFromSource(request.text);
      const path = await adapter.exports?.resolveTarget(
        exportDefaultFileName(request.notePath, 'md-plain'),
        'md-plain',
      );
      if (path === undefined) return undefined;
      await adapter.writeFile(path, new TextEncoder().encode(text));
      return {
        kind: 'written',
        path,
        bytes: new TextEncoder().encode(text).byteLength,
        valueCount: 0,
        render: { engine: 'static', reason: 'no-packs' },
        images: EMPTY_IMAGE_REPORT,
      };
    } catch (error) {
      return { kind: 'failed', reason: reasonOf(error) };
    }
  }

  // format === 'ansi'
  if (renderAnsi === undefined) return undefined;
  try {
    const text = await renderAnsi(request.text);
    const path = await adapter.exports?.resolveTarget(
      exportDefaultFileName(request.notePath, 'ansi'),
      'ansi',
    );
    if (path === undefined) return undefined;
    await adapter.writeFile(path, new TextEncoder().encode(text));
    return {
      kind: 'written',
      path,
      bytes: new TextEncoder().encode(text).byteLength,
      valueCount: 0,
      render: { engine: 'static', reason: 'no-packs' },
      images: EMPTY_IMAGE_REPORT,
    };
  } catch (error) {
    return { kind: 'failed', reason: reasonOf(error) };
  }
}
