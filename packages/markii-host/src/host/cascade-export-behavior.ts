/**
 * The cascade export's shared half: walking the notes a root note links
 * to, rendering each one the way a single-note export does, packing the
 * results into one archive, and every user-facing string that outcome
 * produces. Written once so the hosts cannot drift on what a cascade is
 * or what it says.
 *
 * Deliberately outside `createMarkiiHost`: choosing where the archive goes
 * and writing it are each host's own picker and file-system business, so
 * this module builds the bytes and words the outcome, and the host writes
 * and displays. The per-host nouns (which surface holds the details) come
 * from `HostLabels`, never from a literal here.
 *
 * BOUNDS ARE FIXED. The walk always uses `DEFAULT_CASCADE_MAX_DEPTH` and
 * `DEFAULT_CASCADE_MAX_NOTES`; nothing here lets a caller override them.
 */
import type { StoredValue } from '@markii/runtime';
import type { OnDiagnostic, UnavailableComponent } from '@markii/stdlib';
import {
  CASCADE_INDEX_FILE_NAME,
  DEFAULT_CASCADE_MAX_DEPTH,
  DEFAULT_CASCADE_MAX_NOTES,
  assignCascadeFileNames,
  rewriteCascadeLinks,
  walkNoteCascade,
} from '../export/cascade.js';
import type {
  CascadeLinkResolver,
  CascadeNoteReader,
  CascadeTruncation,
} from '../export/cascade.js';
import {
  buildCascadeIndexHtml,
  buildNoteExport,
  exportBaseName,
  exportDocumentTitle,
} from '../export/note-export.js';
import type {
  HtmlExportEngine,
  ExportBodyRenderer,
  ExportPackStylesheet,
  ExportRenderInfo,
  StaticExportReason,
} from '../export/note-export.js';
import type {
  EmbeddedImageReport,
  ExportImageReader,
} from '../export/image-embed.js';
import { zipExportArchive } from '../export/export-zip.js';
import type { ExportArchiveEntry } from '../export/export-zip.js';
import {
  fileNameOf,
  imageEmbedDiagnosticLines,
  renderEngineDiagnosticLine,
} from './export-behavior.js';
import type { HostLabels } from './adapter.js';

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
  /** The static HTML engine every note and the index page render with. */
  readonly engine: HtmlExportEngine;
  /** The root note's path, in whatever form `readNote` and `resolveLink` understand. */
  readonly rootPath: string;
  readonly readNote: CascadeNoteReader;
  readonly resolveLink: CascadeLinkResolver;
  /** Reads one note's persisted last-run values, keyed by that note's own path. An empty object exports that note's standard empty states. */
  readonly readValues: (notePath: string) => Record<string, StoredValue>;
  /** The host's React render of a note's body, shared by every note in the cascade since it comes from one merged pack registry. Omitted renders every note with the static engine. */
  readonly renderBody?: ExportBodyRenderer;
  /** Why the static engine is used when `renderBody` is omitted. Defaults to `no-packs`. */
  readonly staticReason?: StaticExportReason;
  readonly packStylesheets?: readonly ExportPackStylesheet[];
  readonly packCount?: number;
  /** Installed pack components the static engine cannot draw, labeled "no HTML view" in every note rendered statically. */
  readonly unavailableComponents?: readonly UnavailableComponent[];
  /** Receives the static engine's render diagnostics for every note. */
  readonly onDiagnostic?: OnDiagnostic;
  /** Builds the image reader for one note, bound to that note's own folder so a relative source resolves against the note that wrote it. Omitted embeds no images. */
  readonly embedImagesFor?: (notePath: string) => ExportImageReader;
  /** Hides the collapsed script marker in every exported note. Defaults to `false`. */
  readonly hideScriptBlocks?: boolean;
}

/** The archive a cascade would write, or why it could not be built. Nothing is written here; the caller owns the save path. */
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
export function cascadeReasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `count` plus `noun`, pluralized with a trailing `s`. Every noun used here is regular. */
export function countedNoun(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Walks a note's cascade, exports every note it reaches, and returns the
 * archive bytes. Never throws: an error anywhere in the walk or a render
 * comes back as a `failed` result.
 */
export async function buildCascadeArchive(
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

    // Every archive carries an index.html listing its notes, so an unzipped
    // set has one page to open first; a note named index is renamed clear of it.
    const fileNames = assignCascadeFileNames(
      walk.notes.map((note) => note.path),
      [CASCADE_INDEX_FILE_NAME],
    );

    const notes: CascadeExportedNote[] = [];
    const entries: ExportArchiveEntry[] = [];

    for (const note of walk.notes) {
      const text = rewriteCascadeLinks(note, fileNames, request.resolveLink);
      const document = await buildNoteExport({
        engine: request.engine,
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
        ...(request.unavailableComponents !== undefined
          ? { unavailableComponents: request.unavailableComponents }
          : {}),
        ...(request.onDiagnostic !== undefined
          ? { onDiagnostic: request.onDiagnostic }
          : {}),
        ...(request.embedImagesFor !== undefined
          ? { embedImages: request.embedImagesFor(note.path) }
          : {}),
        ...(request.hideScriptBlocks !== undefined
          ? { hideScriptBlocks: request.hideScriptBlocks }
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

    entries.push({
      name: CASCADE_INDEX_FILE_NAME,
      text: buildCascadeIndexHtml(
        notes.map((note) => ({
          title: exportDocumentTitle(note.path),
          fileName: note.entryName,
        })),
        request.engine,
      ),
    });

    return {
      kind: 'archive',
      bytes: zipExportArchive(entries),
      notes,
      unreadable: walk.unreadable,
      ...(walk.truncated !== undefined ? { truncated: walk.truncated } : {}),
    };
  } catch (error) {
    return { kind: 'failed', reason: cascadeReasonOf(error) };
  }
}

/**
 * The short message shown after a cascade export. A success names the
 * archive and how many notes it holds, plus an optional host-specific
 * `where` sentence (for example where the archive landed). A partial
 * success adds one sentence pointing at the host's diagnostics surface,
 * because a cascade that quietly left notes out would be mute about it. A
 * failure says what failed and points at the same surface, never at a
 * stack trace.
 */
export function cascadeResultMessage(
  outcome: CascadeExportOutcome,
  labels: HostLabels,
  where?: string,
): string {
  if (outcome.kind === 'failed') {
    return `Markii: could not export this cascade. Open ${labels.diagnosticsSurface} for details.`;
  }
  const name = fileNameOf(outcome.path);
  const summary = `Markii: exported ${name} with ${countedNoun(outcome.notes.length, 'note')}.`;
  const partial =
    outcome.truncated !== undefined || outcome.unreadable.length > 0;
  if (partial) {
    return `${summary} Some linked notes were left out, so open ${labels.diagnosticsSurface} for details.`;
  }
  return where === undefined ? summary : `${summary} ${where}`;
}

/**
 * The lines for the host's diagnostics surface for one cascade export:
 * every note reached named with the file it became, every note skipped
 * named with the note that linked to it, and any bound that cut the walk
 * short. A failure reaches here in full, including the reason the popup
 * deliberately omits.
 */
export function cascadeDiagnosticLines(
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
