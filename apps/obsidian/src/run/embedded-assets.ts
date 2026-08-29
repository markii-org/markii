/**
 * Placeholder for the Run path's embedded runtime assets.
 *
 * The plugin build (`esbuild.options.mjs`'s `createMainBuild` — see its
 * `embed-runtime-assets` plugin) rebuilds `worker.browser.js` and reads
 * wasmoon's `glue.wasm`, then REPLACES THIS ENTIRE FILE'S CONTENTS wholesale
 * with the same two `export const` statements below, base64 payload filled
 * in. That is why the file's whole body is just these two exports: the
 * build's `onLoad` swap assumes there is nothing else here to preserve.
 *
 * Running from source — Vitest, a bare `tsc --noEmit`, `npm run dev` before
 * the plugin build has run — sees these empty placeholders instead.
 * `browser-worker.ts`'s `createBrowserWorkerSetup` treats an empty string
 * exactly like "no worker bundled": it returns `undefined`, and the Run
 * path reports that cleanly rather than throwing.
 *
 * Nothing else may ever be added to this file. Its contents are replaced,
 * not appended to or read for anything beyond these two names.
 */

export const EMBEDDED_WORKER_BUNDLE_BASE64: string = '';
export const EMBEDDED_WASM_GLUE_BASE64: string = '';
