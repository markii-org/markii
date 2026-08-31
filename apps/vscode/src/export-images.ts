/**
 * Pure, `vscode`-free wording behind the `markii.exportHtml` command's image
 * reader (GitHub issue #28 slice 3, part 2). `preview-panel.ts`'s
 * `createExportImageReader` does the actual `vscode.Uri` resolution and
 * `vscode.workspace.fs` calls; everything it needs to decide WHAT to say
 * about an outcome, rather than how to reach it, lives here so it is
 * unit-testable without a `vscode` host.
 *
 * The jail decision itself reuses `./resource-roots.ts`'s
 * `isCoveredByRoots`/`isWithinRoot` rather than a second implementation;
 * this module only supplies the detail text for a source that fails it.
 */

/**
 * The detail for a relative image source in a document with no folder to
 * resolve it against, such as an unsaved untitled buffer. Every relative
 * source in that document reads this way; there is nothing to guess at.
 */
export const IMAGE_NO_DOCUMENT_FOLDER_DETAIL =
  'the document has no folder to resolve relative images against';

/**
 * The detail for an image source that resolved outside the note's own
 * folder and every open workspace folder. Named explicitly, never silently
 * embedded: a traversal source like ../../../.ssh/id_rsa.png must read as
 * refused, not as a quiet skip with no reason.
 */
export function imageOutsideWorkspaceDetail(src: string): string {
  return `${src} resolved outside the workspace`;
}

/** The verbatim reason behind a thrown error, for an `unreadable` detail. */
export function imageReadErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One decimal place, with a trailing `.0` dropped. */
function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * A byte count as a short, readable size: exact bytes under 1 KB, otherwise
 * KB or MB rounded to one decimal place. Used both for a too-large skip's
 * size and for the total the embedded images added to the file.
 */
export function formatByteSize(byteLength: number): string {
  if (byteLength < 1024) {
    return byteLength === 1 ? '1 byte' : `${String(byteLength)} bytes`;
  }
  const kib = byteLength / 1024;
  if (kib < 1024) {
    return `${trimDecimal(kib)} KB`;
  }
  return `${trimDecimal(kib / 1024)} MB`;
}
