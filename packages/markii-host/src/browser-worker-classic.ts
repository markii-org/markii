/**
 * The `@markii/host/browser-worker-classic` entry: the Web Worker isolate for
 * a host that starts its worker as a classic worker (typically from a blob
 * URL). Bundling this file as an IIFE with
 * `scripts/browser-worker-build.mjs` produces `dist/browser-worker.classic.js`
 * for the package, or the worker an app embeds in its own bundle. It has no
 * exports: loading it starts the worker's message loop.
 */
import './run/worker-entry-browser.js';
