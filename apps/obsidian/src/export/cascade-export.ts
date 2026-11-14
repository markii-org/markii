/**
 * `obsidian`-free logic behind the "Export Markii note as HTML cascade"
 * command (GitHub issue #28 slice 3, part 2): walking the notes a root
 * note links to, exporting each one with the same machinery
 * `../export-note.ts` uses for a single note, and packing the results
 * into one zip archive beside the root note.
 *
 * ORCHESTRATION ONLY. The walk, the per-note render, the archive, the
 * outcome shape, and every message and diagnostics line belong to
 * `createMarkiiHost(...).exportLinkedSet`, shared with the VS Code
 * extension so the two hosts cannot drift. This module builds the adapter
 * that host reads and writes through: the archive's own path beside the
 * root note, the vault write, and the note reader. `main.ts` stays wiring:
 * it supplies the vault-touching `readNote`/`resolveLink` functions and a
 * per-note image reader (`./export-images.ts`).
 *
 * NO PDF. A cascade export is HTML only; issue #29 covers a cascade PDF,
 * and nothing in this module or `main.ts`'s wiring of it produces one.
 */
import { createHtmlExportEngine } from '@markii/host/html-engine';
import { createMarkiiHost } from '@markii/host';
import { exportBaseName } from '@markii/host/internal';
import type {
  CascadeLinkResolver,
  ExportLinkedSetOutcome,
  ExportLinkedSetRequest,
} from '@markii/host';
import { createObsidianHostAdapter } from '../host-adapter.js';
import type { NoteExportFs } from '../export-note.js';

/** The static HTML engine every note in the cascade renders with. */
const htmlEngine = createHtmlExportEngine();

/** Reads one note's text, or resolves `undefined` when the path is not a readable note. */
export type CascadeNoteText = (
  path: string,
) => string | undefined | Promise<string | undefined>;

/** What the cascade command needs: the shared request plus the vault seams that read and write. */
export interface CascadeExportRequest extends ExportLinkedSetRequest {
  readonly readNote: CascadeNoteText;
  readonly resolveLink: CascadeLinkResolver;
  readonly fs: NoteExportFs;
  /** Receives every diagnostics line. Defaults to the developer console. */
  readonly diagnostics?: (line: string) => void;
}

/** The archive's own path: beside the root note, its base name with `.zip`. */
export function cascadeArchivePath(rootPath: string): string {
  const separator = rootPath.lastIndexOf('/');
  const folder = separator === -1 ? '' : rootPath.slice(0, separator + 1);
  return `${folder}${exportBaseName(rootPath)}.zip`;
}

/**
 * Exports the root note and the notes it links to through the shared host,
 * with the index page this host has always shipped, and writes the archive
 * beside the root note. Never throws: an error anywhere in the walk, a
 * render, or the write comes back as a `failed` outcome.
 */
export async function exportNoteCascade(
  request: CascadeExportRequest,
): Promise<ExportLinkedSetOutcome> {
  const { fs, readNote, diagnostics, ...hostRequest } = request;
  const adapter = createObsidianHostAdapter({
    prompt: async () => false,
    loadLocalStorage: () => undefined,
    saveLocalStorage: () => undefined,
    diagnostics: diagnostics ?? ((line) => console.info(line)),
    readFile: async (path) => {
      const text = await readNote(path);
      if (text === undefined) throw new Error(`${path} is not a readable note`);
      return new TextEncoder().encode(text);
    },
    writeFile: async (path, bytes) => {
      await fs.writeBinary(path, bytes);
    },
    exports: {
      formats: new Set(),
    },
  });
  return createMarkiiHost(adapter, { htmlEngine }).exportLinkedSet({
    ...hostRequest,
    targetPath: cascadeArchivePath(request.rootPath),
  });
}

/** Where the archive landed, appended to the shared success message. */
export const CASCADE_ARCHIVE_PLACEMENT =
  'It sits beside the note in your vault.';
