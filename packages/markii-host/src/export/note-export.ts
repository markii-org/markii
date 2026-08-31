/**
 * Static-export plumbing shared by every host (GitHub issue #28, slice 1):
 * turning one note's text plus its last-run values into a self-contained
 * HTML document, and working out what the resulting file is called.
 *
 * This builds NO renderer of its own. `@markii/html` is the static engine
 * (`packages/platforms/markii-html`): `renderMarkToHtml` walks
 * `@markii/core`'s sanitized hast to an HTML string, and
 * `exportHtmlDocument` wraps that string in the full-page shell with the
 * shared `doc.css` embedded. Everything here is the thin host-neutral layer
 * around those two calls, so the VS Code extension and the Obsidian plugin
 * cannot drift on file naming, on the page CSS an exported file carries, or
 * on how a value store is handed to the engine.
 *
 * WHAT AN EXPORT CONTAINS. The standard component set, rendered statically,
 * with the last run's values baked in wherever a note binds one (`data=`,
 * `:value[...]`). A directive the static engine does not know — every pack
 * component, since packs are React modules the string engine cannot load —
 * comes out as that engine's ordinary unknown-component fallback: a labeled
 * box with the inner markdown still rendered inside it. Nothing crashes and
 * no content is dropped; see `@markii/html`'s `render.ts`.
 */
import { exportHtmlDocument, renderMarkToHtml } from '@markii/html';
import { defaultHtmlRegistry } from '@markii/html/components';
import { createValueStore } from '@markii/runtime';
import type { StoredValue } from '@markii/runtime';

/** The last path segment of a `/`-separated path, or the string itself when it has no separator. */
function lastSegment(pathOrName: string): string {
  const separator = pathOrName.lastIndexOf('/');
  return separator === -1 ? pathOrName : pathOrName.slice(separator + 1);
}

/** The canonical Markii file extension, matching `apps/vscode/src/mark-document.ts`'s `MARK_EXTENSION`. */
export const MARK_EXTENSION = '.mk.md';

/** The extensions an export can be written as. */
export type ExportExtension = '.html' | '.pdf';

/**
 * The name used when a note has no usable base name at all — a file called
 * exactly `.mk.md`, or an empty path segment. Rare enough that neither host
 * offers it as a normal path, but a file name is not optional here, so
 * there has to be one rather than an empty string.
 */
export const FALLBACK_EXPORT_BASE_NAME = 'markii-note';

/**
 * The base name an export is built from: the file name with a recognized
 * Markii/markdown extension removed, case-insensitively. `notes.mk.md` and
 * `notes.md` both give `notes`; a name with any other extension keeps it
 * (`notes.txt` gives `notes.txt`), because guessing at an unknown extension
 * would be more surprising than leaving it alone. A `/`-separated path is
 * accepted too: only its last segment is read.
 */
export function exportBaseName(pathOrName: string): string {
  const fileName = lastSegment(pathOrName);
  const lower = fileName.toLowerCase();
  if (lower.endsWith(MARK_EXTENSION)) {
    const base = fileName.slice(0, fileName.length - MARK_EXTENSION.length);
    return base || FALLBACK_EXPORT_BASE_NAME;
  }
  if (lower.endsWith('.md')) {
    const base = fileName.slice(0, fileName.length - '.md'.length);
    return base || FALLBACK_EXPORT_BASE_NAME;
  }
  return fileName || FALLBACK_EXPORT_BASE_NAME;
}

/** The exported file's name for `fileName`: `notes.mk.md` + `.html` gives `notes.html`. */
export function exportedFileName(
  fileName: string,
  extension: ExportExtension,
): string {
  return `${exportBaseName(fileName)}${extension}`;
}

/**
 * The path an export is written to when it lands beside its source note:
 * the same folder, the same base name, the new extension. `notePath` is a
 * `/`-separated path — a `vscode.Uri.path` or an Obsidian vault-relative
 * path, never a platform `fsPath` — so no `node:path` import and no
 * platform branching is needed, and this module stays environment-free.
 */
export function exportedSiblingPath(
  notePath: string,
  extension: ExportExtension,
): string {
  const separator = notePath.lastIndexOf('/');
  const folder = separator === -1 ? '' : notePath.slice(0, separator + 1);
  const fileName = notePath.slice(separator + 1);
  return `${folder}${exportedFileName(fileName, extension)}`;
}

/** The exported document's `<title>`: the note's own base name, so a browser tab and a PDF's metadata name the note rather than the format. */
export function exportDocumentTitle(fileName: string): string {
  return exportBaseName(fileName);
}

/**
 * The page-level CSS an exported file carries in addition to `doc.css`.
 *
 * `doc.css` is deliberately a LIBRARY stylesheet: it styles `.doc` and
 * never claims `:root` or `body`, because hosts embed it into pages they
 * do not own. A standalone exported file has no host to supply the page
 * around it, so this is that page: a ground color, a readable measure, and
 * print rules, all of them host-authored and trusted (they are passed to
 * `exportHtmlDocument` as `extraCss`, which is inserted verbatim).
 *
 * The print block matters more than it looks: the Obsidian PDF command
 * prints exactly this document, so the paper layout is decided here rather
 * than in a host-specific branch.
 */
export const EXPORT_PAGE_CSS = `
body {
  margin: 0;
  background: #fff;
}
.doc {
  box-sizing: border-box;
  max-width: 46rem;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 4rem;
}
@media print {
  .doc {
    max-width: none;
    margin: 0;
    padding: 0;
  }
  .doc .mk-card,
  .doc .mk-callout,
  .doc .mk-stat,
  .doc .mk-figure,
  .doc .mk-unknown {
    break-inside: avoid;
  }
  /* A collapsed \`details\` prints as its summary alone, which loses the
     content the author wrote. On paper there is nothing to expand, so
     every disclosure prints open. */
  .doc details > *:not(summary) {
    display: block;
  }
}
`;

/** What `buildNoteHtmlExport` needs to turn one note into a standalone file. */
export interface NoteHtmlExportOptions {
  /** The note's full source text. */
  readonly text: string;
  /** The note's file name, used for the document title. A path is accepted; only the last segment is read. */
  readonly fileName: string;
  /**
   * The note's last-run values, exactly as the host persisted them
   * (`readPersistedValues`). Bound components and `:value[...]` markers
   * bake these in. Omitted or empty means the note exports with its
   * standard empty states, which is what a note that has never been run
   * should show.
   */
  readonly values?: Record<string, StoredValue>;
  /** Extra host CSS appended after `doc.css` and `EXPORT_PAGE_CSS`. Trusted, inserted verbatim. */
  readonly extraCss?: string;
}

/**
 * Renders one note to a complete, self-contained HTML document string.
 *
 * Never throws: `renderMarkToHtml` already returns its own failure fallback
 * rather than propagating, so a caller always gets a document it can write.
 */
export function buildNoteHtmlExport(options: NoteHtmlExportOptions): string {
  const values = options.values ?? {};
  const store =
    Object.keys(values).length > 0 ? createValueStore(values) : undefined;
  const body = renderMarkToHtml(options.text, defaultHtmlRegistry, store);
  const extraCss = options.extraCss
    ? `${EXPORT_PAGE_CSS}\n${options.extraCss}`
    : EXPORT_PAGE_CSS;
  return exportHtmlDocument(body, {
    title: exportDocumentTitle(options.fileName),
    extraCss,
  });
}
