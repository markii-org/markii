/**
 * GitHub issue #28 slice 2: turns the webview packs `preview-panel.ts`
 * already loaded (`./pack-context.ts`'s `PackContext.webviewPacks`) into
 * the `ExportPackStylesheet[]` `@markii/host`'s `buildNoteExport` embeds in
 * a React-path export. Reads from the SAME source the webview links its own
 * `<link>` tags from (`preview-panel.ts`'s `setHtml`), so an exported file's
 * pack CSS can never drift from what the live preview actually shows.
 *
 * `vscode`-free and injection-based (`readFile`), matching every other pure
 * module under `src/packs/`, so this is testable with an in-memory fake
 * reader rather than real disk.
 */
import type { ExportPackStylesheet } from '@markii/host';
import type { DiscoveredPack } from '@markii/host';

/** Reads a file's contents as text, or throws/rejects if it cannot. Injected so this module needs no real disk to test. */
export type StylesheetFileReader = (path: string) => Promise<string>;

/**
 * Reads every `webviewPacks` entry's stylesheet, in the order the host
 * loaded them — the same order the webview's own `<link>` tags load in
 * (`preview-panel.ts`'s `setHtml`), which is what decides the cascade
 * between two packs that style the same thing.
 *
 * A pack with no `stylesheetPath` at all (most packs: CSS is optional) is
 * skipped without being treated as a failure. A pack whose stylesheet path
 * IS set but cannot actually be read (removed on disk between load and
 * export, a permissions error, ...) is also skipped quietly: this is an
 * export-completeness nicety, not something worth failing or even reporting
 * an export over, and losing one pack's CSS on an already-rare read failure
 * still leaves every other pack's stylesheet and every component's markup
 * intact.
 */
export async function packExportStylesheets(
  webviewPacks: readonly DiscoveredPack[],
  readFile: StylesheetFileReader,
): Promise<ExportPackStylesheet[]> {
  const sheets: ExportPackStylesheet[] = [];
  for (const pack of webviewPacks) {
    if (pack.stylesheetPath === undefined) continue;
    try {
      const cssText = await readFile(pack.stylesheetPath);
      sheets.push({ namespace: pack.manifest.name, cssText });
    } catch {
      continue;
    }
  }
  return sheets;
}
