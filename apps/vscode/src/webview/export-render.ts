/**
 * GitHub issue #28 slice 2: the webview's half of `markii.exportHtml`
 * rendering through React. `preview-panel.ts` cannot render React itself
 * (the extension host has no DOM); it asks the webview, which already has
 * `main.tsx`'s merged registry (`defaultRegistry` plus every installed
 * pack) sitting in memory for the live preview, to render the SAME note
 * once more as a static string instead.
 *
 * Pure and `vscode`-free: everything here is a plain function over
 * `text`/`values`/a `Registry`, so it is unit-testable without a webview or
 * an extension host at all. The wiring that listens for `export-request` and
 * posts the reply lives in `main.tsx`, matching how `main.tsx` already owns
 * the `pack-diagnostics` wiring around `./pack-registry.ts`.
 *
 * RELATIVE IMAGES: `preview.tsx` resolves a document's relative image
 * sources through `renderMark`'s `resolveImageSrc` option, closing over the
 * document's `baseUri`/`assets` (`./document-images.ts`). This function has
 * neither — `ExportRequestMessage` carries only `text` and `values` — so it
 * calls `renderMark` with no such option, and an exported file keeps the
 * note's own relative image sources exactly as slice 1 already documented
 * for the static engine. This is deliberate, not a gap to close: the
 * extension host's own image embedding (`../export-images.ts`,
 * `@markii/host`'s `embedImagesInHtml`) resolves and reads each source
 * itself, from the note's OWN relative text, after this body comes back.
 */
import { renderMark } from '@markii/react';
import type { Registry } from '@markii/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createValueStore } from '@markii/runtime';
import type { StoredValue } from '@markii/runtime';
import type { ExportRequestMessage, ExportResultMessage } from '../protocol.js';

/**
 * Renders one note's body markup through `registry` — the same
 * `renderMark` call `preview.tsx` uses for the live preview, minus the
 * `.doc` wrapper and page shell: `@markii/host`'s `composeNoteHtmlExport`
 * adds those on the extension-host side, so the two engines can never
 * drift on what surrounds the body.
 */
export function renderExportBody(
  text: string,
  values: Record<string, StoredValue>,
  registry: Registry,
): string {
  const store =
    Object.keys(values).length > 0 ? createValueStore(values) : undefined;
  return renderToStaticMarkup(renderMark(text, registry, store));
}

/** A short, stack-free reason string for a thrown render failure — diagnostics-only, never shown on screen. */
function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the `ExportResultMessage` reply for one `ExportRequestMessage`.
 * `renderExportBody` is not expected to throw, but a registered pack
 * component's own render function can, exactly as `PreviewErrorBoundary`
 * guards against for the live preview — caught here rather than left to
 * become an unhandled rejection with no reply ever sent, which would strand
 * `preview-panel.ts`'s `requestExportBody` until its own timeout.
 */
export function exportResultFor(
  message: ExportRequestMessage,
  registry: Registry,
): ExportResultMessage {
  try {
    const html = renderExportBody(message.text, message.values, registry);
    return {
      type: 'export-result',
      requestId: message.requestId,
      ok: true,
      html,
    };
  } catch (error) {
    return {
      type: 'export-result',
      requestId: message.requestId,
      ok: false,
      reason: reasonFor(error),
    };
  }
}
