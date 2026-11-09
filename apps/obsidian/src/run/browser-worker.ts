/**
 * Wires this plugin's Run path to a Web Worker isolate.
 *
 * Obsidian's renderer cannot create the `node:worker_threads` worker
 * `@markii/host` uses by default: it throws "The V8 platform used by this
 * instance of Node does not support creating Workers", and forking a Node
 * child through `ELECTRON_RUN_AS_NODE` was measured failing here too. A Web
 * Worker is what remains, and `@markii/host`'s `createBrowserHostIsolate` (from `@markii/host/browser`)
 * implements it; this file supplies the two things only the host can know:
 * where the bundled bytes are, and how to turn them into URLs a worker can
 * load.
 *
 * The bytes ship INSIDE `main.js` as base64 (`./embedded-assets.ts`,
 * filled in by `esbuild.options.mjs`'s `embed-runtime-assets` plugin at
 * build time) rather than as separate files next to it. Obsidian's
 * single-file install channels — BRAT, and later the community catalogue —
 * fetch only `main.js`, `manifest.json`, and `styles.css`; a Run path that
 * depended on `worker.browser.js`/`glue.wasm` being copied alongside them
 * would silently do nothing for anyone who installed that way.
 *
 * Blob URLs are still required even though the bytes are already in
 * memory: Chromium refuses to start a worker from `file://`, and this
 * plugin cannot rely on an Obsidian-internal protocol either. Decoding the
 * embedded base64 and handing the result to `Blob` produces the same kind
 * of URL a file read used to.
 *
 * The URLs are minted ONCE per plugin load and reused: a blob URL pins its
 * bytes in memory until revoked, and re-decoding/re-blobbing on every run
 * would be both slower and a leak.
 */
import {
  createBrowserHostIsolate,
  type BrowserNetProviderFactory,
} from '@markii/host/browser';
import type { HostIsolate } from '@markii/host';
import {
  EMBEDDED_WASM_GLUE_BASE64,
  EMBEDDED_WORKER_BUNDLE_BASE64,
} from './embedded-assets.js';
import { decodeBase64 } from './decode-base64.js';

/**
 * Decodes an embedded base64 payload into a blob URL, or `undefined` when
 * there is nothing embedded (the placeholder case: running from source
 * before a build) or the payload is malformed. `decodeBase64` already
 * returns a fresh `Uint8Array`, never a view onto a pooled buffer, so
 * there is no aliasing concern handing it straight to `Blob`.
 */
function blobUrlFor(base64: string, type: string): string | undefined {
  const bytes = decodeBase64(base64);
  if (bytes === undefined) return undefined;
  return URL.createObjectURL(new Blob([bytes], { type }));
}

export interface BrowserWorkerSetup {
  /**
   * The shared browser isolate over the embedded bundle. Its own `dispose`
   * is a no-op: `createMarkiiHost(...).run` calls it after EVERY run, and
   * the blob URLs must outlive that, so they are freed by `dispose` below.
   */
  isolate: Extract<HostIsolate, { kind: 'browser' }>;
  /** Frees the blob URLs. Called from the plugin's `onunload`. */
  dispose: () => void;
}

/**
 * Builds the isolate, given the pinned network provider the HOST will run
 * on the worker's behalf (a Web Worker has no `node:dns` to pin with, so
 * the renderer serves `net.*`, keeping address pinning). Returns
 * `undefined` when the worker bundle was not embedded (the placeholder
 * case: running from source before a build), which the run path already
 * reports cleanly.
 */
export function createBrowserWorkerSetup(
  netProvider: BrowserNetProviderFactory,
): BrowserWorkerSetup | undefined {
  const workerUrl = blobUrlFor(
    EMBEDDED_WORKER_BUNDLE_BASE64,
    'text/javascript',
  );
  if (workerUrl === undefined) return undefined;

  // wasmoon fetches this by URL; absent, it would try a Node resolution
  // that cannot work inside a worker. Missing is not fatal here: the run
  // fails with the sandbox's own error rather than the plugin refusing to
  // start.
  const wasmUrl = blobUrlFor(EMBEDDED_WASM_GLUE_BASE64, 'application/wasm');

  const isolate = createBrowserHostIsolate({
    workerUrl,
    // The embedded worker is an IIFE (classic) bundle, not a module.
    workerType: 'classic',
    netProvider,
    ...(wasmUrl !== undefined ? { wasmUrl } : {}),
  });

  return {
    isolate,
    dispose: () => {
      URL.revokeObjectURL(workerUrl);
      if (wasmUrl !== undefined) URL.revokeObjectURL(wasmUrl);
    },
  };
}
