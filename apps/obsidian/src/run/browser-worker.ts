/**
 * Wires this plugin's Run path to a Web Worker isolate.
 *
 * Obsidian's renderer cannot create the `node:worker_threads` worker
 * `@markii/host` uses by default: it throws "The V8 platform used by this
 * instance of Node does not support creating Workers", and forking a Node
 * child through `ELECTRON_RUN_AS_NODE` was measured failing here too. A Web
 * Worker is what remains, and `@markii/host`'s `createBrowserIsolate`
 * implements it; this file supplies the two things only the host can know:
 * where the bundled files are, and how to turn them into URLs a worker can
 * load.
 *
 * Blob URLs rather than paths, because Chromium refuses to start a worker
 * from `file://` and this plugin cannot rely on an Obsidian-internal
 * protocol. The renderer has `node:fs`, so it reads the bytes it already
 * shipped and hands them over directly.
 *
 * The URLs are minted ONCE per plugin load and reused: a blob URL pins its
 * bytes in memory until revoked, and re-reading a 14 MB wasm file per run
 * would be both slower and a leak.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createBrowserIsolate, type IsolateSpawner } from '@markii/host';
import type { NetProvider } from '@markii/lua';

/** Reads a bundled file and returns a blob URL for it, or `undefined` when it is not there. */
function blobUrlFor(file: string, type: string): string | undefined {
  try {
    const bytes = readFileSync(file);
    // A fresh Uint8Array: a Node Buffer is a view onto a POOLED ArrayBuffer,
    // so handing it to Blob can capture unrelated bytes that happen to share
    // the pool.
    return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type }));
  } catch {
    return undefined;
  }
}

export interface BrowserWorkerSetup {
  spawnIsolate: IsolateSpawner;
  /** Frees the blob URLs. Called from the plugin's `onunload`. */
  dispose: () => void;
}

/**
 * Builds the spawner, given the plugin's own installed folder and the
 * pinned network provider the HOST will run on the worker's behalf.
 * Returns `undefined` when the worker bundle is missing, which is a dev
 * tree before a build rather than something to throw over.
 */
export function createBrowserWorkerSetup(
  pluginDir: string,
  netProvider: (
    netAllowlist: string[],
    maxFetchBytes: number,
    netPolicy: unknown,
  ) => NetProvider,
): BrowserWorkerSetup | undefined {
  const workerUrl = blobUrlFor(
    path.join(pluginDir, 'worker.browser.js'),
    'text/javascript',
  );
  if (workerUrl === undefined) return undefined;

  // wasmoon fetches this by URL; absent, it would try a Node resolution
  // that cannot work inside a worker. Missing is not fatal here: the run
  // fails with the sandbox's own error rather than the plugin refusing to
  // start.
  const wasmUrl = blobUrlFor(
    path.join(pluginDir, 'glue.wasm'),
    'application/wasm',
  );

  const spawnIsolate = createBrowserIsolate({
    createWorker: () => new Worker(workerUrl),
    netProvider,
    ...(wasmUrl !== undefined ? { wasmUri: wasmUrl } : {}),
  });

  return {
    spawnIsolate,
    dispose: () => {
      URL.revokeObjectURL(workerUrl);
      if (wasmUrl !== undefined) URL.revokeObjectURL(wasmUrl);
    },
  };
}
