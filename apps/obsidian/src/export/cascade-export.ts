/**
 * `obsidian`-free logic behind the "Export Markii note as HTML cascade"
 * command (GitHub issue #28 slice 3, part 2): walking the notes a root
 * note links to, exporting each one with the same machinery
 * `../export-note.ts` uses for a single note, and packing the results
 * into one zip archive beside the root note.
 *
 * ORCHESTRATION ONLY. `@markii/host`'s `walkNoteCascade`,
 * `assignCascadeFileNames`, `rewriteCascadeLinks`, and `zipExportArchive`
 * already do the graph walk, the file naming, the link rewriting, and the
 * archive packing (`packages/markii-host/src/export/cascade.ts` and
 * `export-zip.ts`). This module supplies the per-note render, through the
 * exact `buildNoteExport` call `../export-note.ts` uses, so a cascade
 * export and a single-note export never drift on what a rendered note
 * looks like; it decides the archive's own name and path, and it owns
 * every user-facing string this command produces. `main.ts` stays wiring:
 * it supplies the vault-touching `readNote`/`resolveLink` functions and a
 * per-note image reader (`./export-images.ts`), the same split
 * `../export-note.ts` uses for the single-note commands.
 *
 * BOUNDS ARE FIXED. This always walks with `@markii/host`'s
 * `DEFAULT_CASCADE_MAX_DEPTH`/`DEFAULT_CASCADE_MAX_NOTES`; nothing here
 * lets a caller override them, so the walk's shape cannot silently vary
 * between callers or grow unbounded.
 *
 * NO PDF. A cascade export is HTML only; issue #29 covers a cascade PDF,
 * and nothing in this module or `main.ts`'s wiring of it produces one.
 */
import {
  CASCADE_INDEX_FILE_NAME,
  DEFAULT_CASCADE_MAX_DEPTH,
  DEFAULT_CASCADE_MAX_NOTES,
  assignCascadeFileNames,
  buildCascadeIndexHtml,
  buildNoteExport,
  exportBaseName,
  exportDocumentTitle,
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
import { countedNoun } from '../export-note.js';
import type { NoteExportFs } from '../export-note.js';

/** What the cascade command needs beyond a single note's export inputs: how to walk and read the linked notes, and how to build each one's image reader. */
export interface CascadeExportRequest {
  /** The root note's vault-relative, `/`-separated path. */
  readonly rootPath: string;
  readonly readNote: CascadeNoteReader;
  readonly resolveLink: CascadeLinkResolver;
  /** Reads one note's persisted last-run values, keyed by that note's own path. Returning an empty object exports that note's standard empty states. */
  readonly readValues: (notePath: string) => Record<string, StoredValue>;
  readonly fs: NoteExportFs;
  /** The host's React render of a note's body, shared across every note in the cascade since it comes from one merged pack registry. Omitted renders every note with the static engine. */
  readonly renderBody?: ExportBodyRenderer;
  /** Why the static engine is used when `renderBody` is omitted. Defaults to `no-packs`. */
  readonly staticReason?: StaticExportReason;
  readonly packStylesheets?: readonly ExportPackStylesheet[];
  readonly packCount?: number;
  /** Builds the image reader for one note, bound to that note's own path so a relative image source resolves against the note that wrote it. Omitted embeds no images. */
  readonly embedImagesFor?: (notePath: string) => ExportImageReader;
  /**
   * Hides the collapsed script marker in every exported note, mirroring
   * the "Hide script blocks" setting (`../settings.ts`'s
   * `hideScriptBlocks`) this vault's preview was showing. Defaults to
   * `false`.
   */
  readonly hideScriptBlocks?: boolean;
}

/** One note the cascade exported, for the diagnostics surface. */
export interface CascadeExportedNote {
  /** The note's own vault-relative path. */
  readonly path: string;
  /** The file name this note got inside the archive. */
  readonly entryName: string;
  readonly valueCount: number;
  readonly render: ExportRenderInfo;
  readonly images: EmbeddedImageReport;
}

/** What one cascade export attempt produced. */
export type CascadeExportOutcome =
  | {
      readonly kind: 'cascade';
      /** The written archive's vault-relative path. */
      readonly archivePath: string;
      /** Every note the archive contains, breadth first, the root note first. */
      readonly notes: readonly CascadeExportedNote[];
      /** A linked note the walk could not read, and which note linked to it. */
      readonly unreadable: readonly {
        readonly path: string;
        readonly from: string;
      }[];
      /** Set when a bound stopped the walk before it ran out of links to follow. */
      readonly truncated?: CascadeTruncation;
    }
  | {
      /** Nothing was written. */
      readonly kind: 'failed';
      readonly reason: string;
    };

/** The verbatim reason for a thrown value, for the console. Never shown in a notice. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The last path segment of a vault-relative path, for naming a file in a notice. */
function fileNameOf(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? path : path.slice(separator + 1);
}

/** The archive's own path: beside the root note, its base name with `.zip`. */
export function cascadeArchivePath(rootPath: string): string {
  const separator = rootPath.lastIndexOf('/');
  const folder = separator === -1 ? '' : rootPath.slice(0, separator + 1);
  return `${folder}${exportBaseName(rootPath)}.zip`;
}

/**
 * Walks a note's cascade, exports every note it reaches, and writes the
 * archive. Never throws: an error anywhere in the walk, a render, or the
 * write comes back as a `failed` outcome instead of propagating, matching
 * `../export-note.ts`'s two commands.
 */
export async function exportNoteCascade(
  request: CascadeExportRequest,
): Promise<CascadeExportOutcome> {
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
      [CASCADE_INDEX_FILE_NAME],
    );

    const exportedNotes: CascadeExportedNote[] = [];
    const entries: ExportArchiveEntry[] = [];

    for (const note of walk.notes) {
      const rewrittenText = rewriteCascadeLinks(
        note,
        fileNames,
        request.resolveLink,
      );
      const document = await buildNoteExport({
        text: rewrittenText,
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
        ...(request.hideScriptBlocks !== undefined
          ? { hideScriptBlocks: request.hideScriptBlocks }
          : {}),
      });

      const entryName =
        fileNames.get(note.path) ?? `${exportBaseName(note.path)}.html`;
      entries.push({ name: entryName, text: document.html });
      exportedNotes.push({
        path: note.path,
        entryName,
        valueCount: document.valueCount,
        render: document.render,
        images: document.images,
      });
    }

    // The archive's entry file (issue #28 slice 3, part 3): a reader who
    // unzips a cascade has no single note to open first otherwise, so this
    // lists every exported note by title, in the same breadth-first order
    // the walk reached them, each linking to its own file.
    entries.push({
      name: CASCADE_INDEX_FILE_NAME,
      text: buildCascadeIndexHtml(
        exportedNotes.map((note) => ({
          title: exportDocumentTitle(note.path),
          fileName: note.entryName,
        })),
      ),
    });

    const archivePath = cascadeArchivePath(request.rootPath);
    const archiveBytes = zipExportArchive(entries);
    await request.fs.writeBinary(archivePath, archiveBytes);

    return {
      kind: 'cascade',
      archivePath,
      notes: exportedNotes,
      unreadable: walk.unreadable,
      ...(walk.truncated !== undefined ? { truncated: walk.truncated } : {}),
    };
  } catch (error) {
    return { kind: 'failed', reason: reasonOf(error) };
  }
}

/**
 * The `Notice` text for one cascade outcome. Same style as
 * `../export-note.ts`'s `exportNoticeText`: at most two short sentences,
 * naming the archive and how many notes it holds. The verbatim reason for
 * a failure lives in `exportCascadeDiagnosticLines`, never here.
 */
export function exportCascadeNoticeText(outcome: CascadeExportOutcome): string {
  if (outcome.kind === 'failed') {
    return 'Markii: could not export this cascade. Open the Markii diagnostics for details.';
  }
  const name = fileNameOf(outcome.archivePath);
  return `Markii: exported ${name} with ${countedNoun(outcome.notes.length, 'note')}. It sits beside the note in your vault.`;
}

/**
 * The console lines for one cascade outcome, this host's diagnostics
 * surface: one line per exported note, the reason a bound stopped the
 * walk when one did, one line per note a link pointed at that could not
 * be read, and the archive's own path and entry count.
 */
export function exportCascadeDiagnosticLines(
  outcome: CascadeExportOutcome,
): string[] {
  if (outcome.kind === 'failed') {
    return [`Cascade export failed: ${outcome.reason}`];
  }

  const lines: string[] = [];
  for (const note of outcome.notes) {
    lines.push(
      `Exported ${note.path} as ${note.entryName} with ${countedNoun(note.valueCount, 'stored value')} baked in.`,
    );
  }
  if (outcome.truncated === 'depth') {
    lines.push(
      `The walk stopped at the maximum depth of ${String(DEFAULT_CASCADE_MAX_DEPTH)} hops.`,
    );
  } else if (outcome.truncated === 'count') {
    lines.push(
      `The walk stopped at the maximum note count of ${String(DEFAULT_CASCADE_MAX_NOTES)}.`,
    );
  }
  for (const entry of outcome.unreadable) {
    lines.push(`Could not read ${entry.path}, linked from ${entry.from}.`);
  }
  lines.push(
    `Wrote ${outcome.archivePath} with ${countedNoun(outcome.notes.length, 'note')}.`,
  );
  return lines;
}
