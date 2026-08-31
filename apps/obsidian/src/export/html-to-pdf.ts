/**
 * The ONE module in this plugin that touches Electron (GitHub issue #28
 * slice 1). Everything else about the PDF command — the flow, the wording,
 * the failure classification, the fallback to writing HTML — lives in
 * `../export-note.ts` behind the injected `HtmlToPdf` seam, so it is plain
 * testable code. This module is the implementation of that seam, and it is
 * deliberately not unit-tested: Vitest has no Electron and no Obsidian
 * window, and a mock of `BrowserWindow` would only assert that this file
 * calls the functions this file calls.
 *
 * HOW IT PRINTS. Obsidian desktop is an Electron app, and its renderer runs
 * with Node integration, so `require` is on the global object. From there:
 *
 *   1. `require('electron')`, then `@electron/remote` as a fallback, to
 *      reach a `BrowserWindow` constructor. Electron removed the built-in
 *      `remote` module in v14; Obsidian re-exposes the same surface through
 *      `@electron/remote`, and different Obsidian builds have put it in
 *      different places, so both are tried.
 *   2. The document is written to a transient file inside the NOTE'S OWN
 *      folder, prefixed with a dot so Obsidian hides it, and removed again
 *      in a `finally`. It has to live there rather than in a temp directory
 *      because an exported note keeps its relative image sources, and the
 *      printed page must resolve them the same way the exported HTML does.
 *   3. A hidden `BrowserWindow` loads that file and `webContents.printToPDF`
 *      renders it. The window runs with JavaScript disabled: an exported
 *      Markii document is static by construction (`@markii/html` emits no
 *      scripts), so nothing in it needs to run, and a print window that
 *      cannot execute anything is the safer window to open.
 *
 * `window.print` is deliberately NOT used: it opens a dialog rather than
 * writing a file, which is a different feature.
 *
 * EVERY STEP IS FEATURE-DETECTED AT CALL TIME, never at module load: this
 * module is imported by `main.ts` on every device, including ones where
 * none of the above exists. A missing surface throws
 * `HtmlToPdfUnavailableError`, which the command turns into "PDF is not
 * available on this device, the HTML file was written instead". Anything
 * else that goes wrong throws an ordinary `Error` and lands on the same
 * fallback with a different sentence. Neither reaches the user as a dump.
 */
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HtmlToPdfUnavailableError } from '../export-note.js';
import type { HtmlToPdf, HtmlToPdfRequest } from '../export-note.js';

/** The slice of `webContents` this module uses. */
interface WebContentsLike {
  printToPDF(options: Record<string, unknown>): Promise<Uint8Array>;
}

/** The slice of `BrowserWindow` this module uses. */
interface BrowserWindowLike {
  readonly webContents: WebContentsLike;
  loadFile(filePath: string): Promise<void>;
  destroy(): void;
}

/** The constructor shape a usable `BrowserWindow` has. */
type BrowserWindowConstructor = new (
  options: Record<string, unknown>,
) => BrowserWindowLike;

/** The renderer's Node `require`, when this process has one. Read off the global object rather than written as a bare `require` call so the bundler never tries to resolve it. */
function rendererRequire(): ((id: string) => unknown) | undefined {
  const candidate = (globalThis as { require?: unknown }).require;
  return typeof candidate === 'function'
    ? (candidate as (id: string) => unknown)
    : undefined;
}

/** `require(id)`, or `undefined` when there is no require or the module is not installed. Never throws. */
function tryRequire(id: string): unknown {
  const req = rendererRequire();
  if (!req) return undefined;
  try {
    return req(id);
  } catch {
    return undefined;
  }
}

/** Reads a property off an unknown value without assuming it is an object. */
function property(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/**
 * The `BrowserWindow` constructor this device offers, or `undefined`. Tried
 * in the order most likely to exist in a current Obsidian build: the
 * `remote` surface hanging off the `electron` module, then `@electron/remote`
 * on its own, then a main-process-style `electron.BrowserWindow` for the
 * unlikely case of running where that is reachable.
 */
function findBrowserWindow(): BrowserWindowConstructor | undefined {
  const electron = tryRequire('electron');
  const candidates: unknown[] = [
    property(property(electron, 'remote'), 'BrowserWindow'),
    property(tryRequire('@electron/remote'), 'BrowserWindow'),
    property(electron, 'BrowserWindow'),
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'function') {
      return candidate as BrowserWindowConstructor;
    }
  }
  return undefined;
}

/** The transient print-source file name. Dot-prefixed so Obsidian hides it, and unique so two exports at once cannot collide. */
function transientFileName(): string {
  const stamp = Date.now().toString(36);
  const noise = Math.random().toString(36).slice(2, 8);
  return `.markii-print-${stamp}-${noise}.html`;
}

/** The `printToPDF` options an exported note is printed with. Backgrounds on, so a callout's tint survives; margins from the printer's own defaults, since `EXPORT_PAGE_CSS`'s print block already removes the page padding. */
const PRINT_OPTIONS: Readonly<Record<string, unknown>> = {
  printBackground: true,
  landscape: false,
  pageSize: 'A4',
};

/**
 * Builds the Electron-backed `HtmlToPdf`. Always returns a function: the
 * detection happens when that function is CALLED, so a plugin loaded on a
 * device with no Electron surface still loads, and the command still runs
 * and still produces a file.
 */
export function createElectronHtmlToPdf(): HtmlToPdf {
  return async function electronHtmlToPdf(
    request: HtmlToPdfRequest,
  ): Promise<Uint8Array> {
    if (request.baseDir === undefined) {
      throw new HtmlToPdfUnavailableError(
        'this vault has no filesystem path, so there is nowhere to print from',
      );
    }
    const BrowserWindow = findBrowserWindow();
    if (!BrowserWindow) {
      throw new HtmlToPdfUnavailableError(
        'no Electron BrowserWindow is reachable from this Obsidian build',
      );
    }

    const sourcePath = join(request.baseDir, transientFileName());
    writeFileSync(sourcePath, request.html, 'utf8');

    let window: BrowserWindowLike | undefined;
    try {
      window = new BrowserWindow({
        show: false,
        webPreferences: {
          // An exported document is static by construction, so nothing in
          // it needs to run, and nothing in it gets to.
          javascript: false,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      await window.loadFile(sourcePath);
      const printed: unknown = await window.webContents.printToPDF({
        ...PRINT_OPTIONS,
      });
      if (!(printed instanceof Uint8Array)) {
        throw new Error('printToPDF returned something other than PDF bytes');
      }
      return printed;
    } finally {
      try {
        window?.destroy();
      } catch {
        // A window that cannot be destroyed is not worth failing an
        // otherwise-finished export over; it goes with the plugin unload.
      }
      try {
        unlinkSync(sourcePath);
      } catch {
        // The transient file is dot-prefixed and hidden. Failing to remove
        // it must never turn a written PDF into a reported failure.
      }
    }
  };
}
