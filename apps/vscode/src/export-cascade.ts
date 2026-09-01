/**
 * `vscode`-free logic behind the `markii.exportHtmlCascade` command
 * ("Markii: Export as HTML cascade", GitHub issue #36): walking the notes a
 * root note links to, exporting each one exactly the way
 * `markii.exportHtml` exports a single note, and packing the results into
 * one zip archive.
 *
 * ORCHESTRATION AND WORDING ONLY. The graph walk, the archive file naming,
 * the link rewriting, and the zip itself are `@markii/host`'s
 * (`walkNoteCascade`, `assignCascadeFileNames`, `rewriteCascadeLinks`,
 * `zipExportArchive`), shared with the Obsidian plugin's cascade command so
 * the two hosts cannot drift on what a cascade IS. The per-note render goes
 * through the same `buildNoteExport` call `preview-panel.ts` uses for a
 * single note, so a cascade export and a single export never drift on what
 * a rendered note looks like.
 *
 * `preview-panel.ts` stays wiring: it supplies the workspace-touching
 * seams this module cannot import for itself, a note reader, a link
 * resolver (`./cascade-links.ts` plus the panel's own root check), the
 * persisted-values reader, the webview renderer, and one image reader per
 * note reached. It also writes the bytes, since only it knows where the
 * user chose to save them.
 *
 * BOUNDS ARE FIXED. The walk always uses `@markii/host`'s
 * `DEFAULT_CASCADE_MAX_DEPTH`/`DEFAULT_CASCADE_MAX_NOTES`. Nothing here
 * lets a caller override them, so one command can never turn into a
 * whole-workspace export.
 */
import {
  DEFAULT_CASCADE_MAX_DEPTH,
  DEFAULT_CASCADE_MAX_NOTES,
  assignCascadeFileNames,
  buildNoteExport,
  exportBaseName,
  rewriteCascadeLinks,
  walkNoteCascade,
  zipExportArchive,
} from '@markii/host';
import type {
  CascadeLinkResolver,
  CascadeNoteReader,
  CascadeTruncation,
  EmbeddedImageReport,
  ExportArchiveEntry,
  ExportBodyRenderer,
  ExportImageReader,
  ExportPackStylesheet,
  ExportRenderInfo,
  StaticExportReason,
} from '@markii/host';
import type { StoredValue } from '@markii/runtime';
import {
  fileNameOf,
  imageEmbedDiagnosticLines,
  renderEngineDiagnosticLine,
} from './export-html.js';

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
 * `exportHtmlDefaultFileName`.
 */
export function exportCascadeDefaultFileName(uriPath: string): string {
  return `${exportBaseName(uriPath)}.zip`;
}

/** One note the cascade exported, for the diagnostics surface. */
export interface CascadeExportedNote {
  /** The note's own path, in the same form the reader and resolver use. */
  readonly path: string;
  /** The file name this note got inside the archive. */
  readonly entryName: string;
  readonly valueCount: number;
  readonly render: ExportRenderInfo;
  readonly images: EmbeddedImageReport;
}

/** A link that resolved to a note in range which could not be read. */
export interface UnreadableCascadeNote {
  readonly path: string;
  readonly from: string;
}

/** What one cascade export attempt did, for both the message and the diagnostics lines. */
export type CascadeExportOutcome =
  | {
      readonly kind: 'written';
      /** The written archive's display path. */
      readonly path: string;
      readonly bytes: number;
      /** Every note the archive contains, breadth first, the root note first. */
      readonly notes: readonly CascadeExportedNote[];
      /** Notes a link pointed at that could not be read. */
      readonly unreadable: readonly UnreadableCascadeNote[];
      /** Set when a bound stopped the walk before it ran out of links to follow. */
      readonly truncated?: CascadeTruncation;
    }
  | {
      readonly kind: 'failed';
      /** Where the write was attempted, when it got that far. */
      readonly path?: string;
      /** The verbatim reason. Diagnostics only, never the popup. */
      readonly reason: string;
    };

/** What building one cascade archive needs beyond a single note's export inputs. */
export interface CascadeArchiveRequest {
  /** The root note's path, in whatever form `readNote` and `resolveLink` understand. */
  readonly rootPath: string;
  readonly readNote: CascadeNoteReader;
  readonly resolveLink: CascadeLinkResolver;
  /** Reads one note's persisted last-run values, keyed by that note's own path. An empty object exports that note's standard empty states. */
  readonly readValues: (notePath: string) => Record<string, StoredValue>;
  /** The host's React render of a note's body, shared by every note in the cascade since it comes from one merged pack registry. Omitted renders every note with the static engine. */
  readonly renderBody?: ExportBodyRenderer;
  /** Why the static engine is used when `renderBody` is omitted. Defaults to `no-packs` in `@markii/host`. */
  readonly staticReason?: StaticExportReason;
  readonly packStylesheets?: readonly ExportPackStylesheet[];
  readonly packCount?: number;
  /** Builds the image reader for one note, bound to that note's own folder so a relative source resolves against the note that wrote it. Omitted embeds no images. */
  readonly embedImagesFor?: (notePath: string) => ExportImageReader;
}

/** The archive this command would write, or why it could not be built. Nothing is written here; the caller owns the save path. */
export type CascadeArchiveResult =
  | {
      readonly kind: 'archive';
      readonly bytes: Uint8Array;
      readonly notes: readonly CascadeExportedNote[];
      readonly unreadable: readonly UnreadableCascadeNote[];
      readonly truncated?: CascadeTruncation;
    }
  | { readonly kind: 'failed'; readonly reason: string };

/** The verbatim reason for a thrown value, for the diagnostics surface. Never shown in a popup. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `count` plus `noun`, pluralized with a trailing `s`. Every noun this
 * module uses is regular.
 */
function countedNoun(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Walks a note's cascade, exports every note it reaches, and returns the
 * archive bytes.
 *
 * Never throws: an error anywhere in the walk or a render comes back as a
 * `failed` result instead of propagating, matching how the single-note
 * export reports its own failures.
 */
export async function buildNoteCascadeArchive(
  request: CascadeArchiveRequest,
): Promise<CascadeArchiveResult> {
  try {
    const walk = await walkNoteCascade({
      rootPath: request.rootPath,
      readNote: request.readNote,
      resolveLink: request.resolveLink,
      maxDepth: DEFAULT_CASCADE_MAX_DEPTH,
      maxNotes: DEFAULT_CASCADE_MAX_NOTES,
    });

    if (walk.notes.length === 0) {
      const rootUnreadable = walk.unreadable.find(
        (entry) => entry.path === request.rootPath,
      );
      return {
        kind: 'failed',
        reason: rootUnreadable
          ? `could not read the root note ${rootUnreadable.path}`
          : 'nothing was exported',
      };
    }

    const fileNames = assignCascadeFileNames(
      walk.notes.map((note) => note.path),
    );

    const notes: CascadeExportedNote[] = [];
    const entries: ExportArchiveEntry[] = [];

    for (const note of walk.notes) {
      const text = rewriteCascadeLinks(note, fileNames, request.resolveLink);
      const document = await buildNoteExport({
        text,
        fileName: note.path,
        values: request.readValues(note.path),
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
        ...(request.embedImagesFor !== undefined
          ? { embedImages: request.embedImagesFor(note.path) }
          : {}),
      });

      const entryName =
        fileNames.get(note.path) ?? `${exportBaseName(note.path)}.html`;
      entries.push({ name: entryName, text: document.html });
      notes.push({
        path: note.path,
        entryName,
        valueCount: document.valueCount,
        render: document.render,
        images: document.images,
      });
    }

    return {
      kind: 'archive',
      bytes: zipExportArchive(entries),
      notes,
      unreadable: walk.unreadable,
      ...(walk.truncated !== undefined ? { truncated: walk.truncated } : {}),
    };
  } catch (error) {
    return { kind: 'failed', reason: reasonOf(error) };
  }
}

/**
 * The short message shown after a cascade export. A success names the
 * archive and how many notes it holds. A partial success adds one sentence
 * pointing at the output channel, because a cascade that quietly left
 * notes out would be mute about it otherwise; which notes, and why, is
 * `exportCascadeDiagnosticLines`'s job. A failure says what failed and
 * points at the same surface, never at a stack trace.
 */
export function exportCascadeResultMessage(
  outcome: CascadeExportOutcome,
): string {
  if (outcome.kind === 'failed') {
    return 'Markii: could not export this cascade. Open the Markii output for details.';
  }
  const name = fileNameOf(outcome.path);
  const summary = `Markii: exported ${name} with ${countedNoun(outcome.notes.length, 'note')}.`;
  const partial =
    outcome.truncated !== undefined || outcome.unreadable.length > 0;
  return partial
    ? `${summary} Some linked notes were left out, so open the Markii output for details.`
    : summary;
}

/**
 * The lines written to the "Markii" output channel for one cascade export
 * — this extension's designated diagnostics surface. Every note reached is
 * named with the file it became, every note that was skipped is named with
 * the note that linked to it, and a bound that cut the walk short says so.
 * A failure reaches here in full, including the reason the popup
 * deliberately omits.
 */
export function exportCascadeDiagnosticLines(
  outcome: CascadeExportOutcome,
): string[] {
  if (outcome.kind === 'failed') {
    const where = outcome.path ? ` to ${outcome.path}` : '';
    return [`Cascade export failed${where}: ${outcome.reason}`];
  }

  const lines: string[] = [
    `Cascade export wrote ${outcome.path}: ${String(outcome.bytes)} bytes, ${countedNoun(outcome.notes.length, 'note')}.`,
  ];
  for (const note of outcome.notes) {
    lines.push(
      `Exported ${note.path} as ${note.entryName} with ${countedNoun(note.valueCount, 'stored value')} baked in.`,
      renderEngineDiagnosticLine(note.render),
      ...imageEmbedDiagnosticLines(note.images),
    );
  }
  if (outcome.truncated === 'depth') {
    lines.push(
      `The walk stopped at the maximum depth of ${String(DEFAULT_CASCADE_MAX_DEPTH)} hops, so notes further out were left out.`,
    );
  } else if (outcome.truncated === 'count') {
    lines.push(
      `The walk stopped at the maximum of ${countedNoun(DEFAULT_CASCADE_MAX_NOTES, 'note')}, so the remaining links were left out.`,
    );
  }
  for (const entry of outcome.unreadable) {
    lines.push(`Could not read ${entry.path}, linked from ${entry.from}.`);
  }
  return lines;
}
