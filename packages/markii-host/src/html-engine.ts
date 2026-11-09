/**
 * The `@markii/html`-backed `HtmlExportEngine`. Kept out of the main entry
 * (it is the one module that carries the static HTML renderer); a host that
 * exports HTML builds it here and hands it to `createMarkiiHost`'s
 * `htmlEngine` option or to `buildNoteExport`. Reached through
 * `@markii/host/node`.
 */
import { escapeHtml, exportHtmlDocument, renderMarkToHtml } from '@markii/html';
import { defaultHtmlRegistry } from '@markii/html/components';
import type { HtmlExportEngine } from './export/note-export.js';

export function createHtmlExportEngine(): HtmlExportEngine {
  return {
    renderBody: (text, store, diagnostics) =>
      renderMarkToHtml(text, defaultHtmlRegistry, store, undefined, {
        ...(diagnostics.unavailableComponents !== undefined
          ? { unavailableComponents: diagnostics.unavailableComponents }
          : {}),
        ...(diagnostics.onDiagnostic !== undefined
          ? { onDiagnostic: diagnostics.onDiagnostic }
          : {}),
      }),
    composeDocument: (bodyHtml, options) =>
      exportHtmlDocument(bodyHtml, {
        title: options.title,
        extraCss: options.extraCss,
        ...(options.docClassName !== undefined
          ? { docClassName: options.docClassName }
          : {}),
      }),
    escapeHtml,
  };
}
