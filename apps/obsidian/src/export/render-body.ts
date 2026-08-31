/**
 * The render seam behind the export commands' React path (GitHub issue
 * #28, slice 2). `obsidian`-free, like `../render-document.tsx`: it takes
 * a note's text and a plain value map and hands back the body markup a
 * `.doc` wrapper goes around, using the exact registry the preview
 * renders with, so a pack component exports as itself instead of the
 * static engine's unknown-component box.
 *
 * `renderNoteBodyToHtml` is the plain function; `renderNoteBodyForExport`
 * wraps it in `@markii/host`'s `ExportBodyRenderer` shape, catching
 * whatever the render throws (a hostile pack component, a bad third-party
 * hook) and reporting `render-failed` instead of letting the export
 * command's caller crash. `../export-note.ts` decides what to do with that
 * result; this module only produces it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { createValueStore } from '@markii/runtime';
import type { StoredValue } from '@markii/runtime';
import type { Registry } from '@markii/react';
import type { ExportBodyRenderer, ExportBodyResult } from '@markii/host';
import { renderDocument } from '../render-document.js';

/**
 * Renders one note's body to an HTML string: the same `renderDocument`
 * call the preview makes, through `registry` (defaults to the plain
 * standard set, matching `renderDocument`'s own default), then flattened
 * with React's static-markup renderer since an exported file has no React
 * runtime of its own to hydrate into.
 *
 * `values` becomes a `ValueStore` only when it has entries, so a note that
 * has never been run renders its ordinary empty states, exactly as
 * `renderDocument` already does for `undefined`.
 *
 * Can throw: a pack component that throws during render is not caught
 * here on purpose, so `renderNoteBodyForExport` below is the one place
 * that decides what a caller sees for that case.
 */
export function renderNoteBodyToHtml(
  text: string,
  values: Record<string, StoredValue>,
  registry?: Registry,
): string {
  const store =
    Object.keys(values).length > 0 ? createValueStore(values) : undefined;
  return renderToStaticMarkup(renderDocument(text, store, registry));
}

/** The verbatim detail behind a thrown value, for the diagnostics surface only. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds an `ExportBodyRenderer` bound to `registry`, for
 * `NoteExportBuildRequest.renderBody`. A throw from `renderNoteBodyToHtml`
 * is caught and reported as `render-failed` rather than propagating, so
 * `buildNoteExport` always gets a settled result and can fall back to the
 * static engine.
 */
export function renderNoteBodyForExport(
  registry?: Registry,
): ExportBodyRenderer {
  return (text, values): ExportBodyResult => {
    try {
      return { ok: true, html: renderNoteBodyToHtml(text, values, registry) };
    } catch (error) {
      return { ok: false, reason: 'render-failed', detail: detailOf(error) };
    }
  };
}
