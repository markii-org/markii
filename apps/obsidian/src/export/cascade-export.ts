/**
 * `obsidian`-free logic behind the "Export Markii note as HTML cascade"
 * command (GitHub issue #28 slice 3, part 2): walking the notes a root
 * note links to, exporting each one with the same machinery
 * `../export-note.ts` uses for a single note, and packing the results
 * into one zip archive beside the root note.
 *
 * ORCHESTRATION ONLY. The walk, the per-note render, the archive, the
 * outcome shape, and every message and diagnostics line are
 * `@markii/host`'s (`buildCascadeArchive`, `cascadeResultMessage`,
 * `cascadeDiagnosticLines`), shared with the VS Code extension so the two
 * hosts cannot drift. This module decides the archive's own name and path
 * beside the root note and writes it. `main.ts` stays wiring: it supplies
 * the vault-touching `readNote`/`resolveLink` functions and a per-note
 * image reader (`./export-images.ts`).
 *
 * NO PDF. A cascade export is HTML only; issue #29 covers a cascade PDF,
 * and nothing in this module or `main.ts`'s wiring of it produces one.
 */
import { createHtmlExportEngine } from '@markii/host/html-engine';
import {
  buildCascadeArchive,
  cascadeReasonOf,
  exportBaseName,
} from '@markii/host/internal';
import type {
  CascadeArchiveRequest,
  CascadeExportOutcome,
} from '@markii/host/internal';
import type { NoteExportFs } from '../export-note.js';

/** The static HTML engine every note in the cascade renders with. */
const htmlEngine = createHtmlExportEngine();

/** What the cascade command needs: the shared archive request plus where to write it. */
export interface CascadeExportRequest extends Omit<
  CascadeArchiveRequest,
  'engine'
> {
  readonly fs: NoteExportFs;
}

/** The archive's own path: beside the root note, its base name with `.zip`. */
export function cascadeArchivePath(rootPath: string): string {
  const separator = rootPath.lastIndexOf('/');
  const folder = separator === -1 ? '' : rootPath.slice(0, separator + 1);
  return `${folder}${exportBaseName(rootPath)}.zip`;
}

/**
 * Builds the cascade archive through the shared host path, with the index
 * page this host has always shipped, and writes it beside the root note.
 * Never throws: an error anywhere in the walk, a render, or the write
 * comes back as a `failed` outcome.
 */
export async function exportNoteCascade(
  request: CascadeExportRequest,
): Promise<CascadeExportOutcome> {
  try {
    const { fs, ...archiveRequest } = request;
    const archive = await buildCascadeArchive({
      ...archiveRequest,
      engine: htmlEngine,
    });
    if (archive.kind === 'failed') return archive;

    const path = cascadeArchivePath(request.rootPath);
    await fs.writeBinary(path, archive.bytes);
    return {
      kind: 'written',
      path,
      bytes: archive.bytes.byteLength,
      notes: archive.notes,
      unreadable: archive.unreadable,
      ...(archive.truncated !== undefined
        ? { truncated: archive.truncated }
        : {}),
    };
  } catch (error) {
    return { kind: 'failed', reason: cascadeReasonOf(error) };
  }
}

/** Where the archive landed, appended to the shared success message. */
export const CASCADE_ARCHIVE_PLACEMENT =
  'It sits beside the note in your vault.';
