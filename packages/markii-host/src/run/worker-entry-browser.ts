/**
 * The Web Worker isolate entry, for a host that cannot create a worker
 * thread. An Obsidian plugin is the case that forced it: its Electron
 * renderer rejects `node:worker_threads` outright ("The V8 platform used by
 * this instance of Node does not support creating Workers"), and forking a
 * Node child through `ELECTRON_RUN_AS_NODE` was measured failing there too.
 *
 * Everything a run actually DOES lives in `./run-job.ts` and is shared with
 * the Node entry, so the sandbox, the tier gate, the marshaling limits, and
 * the failure classification cannot drift between hosts. This file supplies
 * only the two things a Web Worker has to do differently:
 *
 *   1. Network goes through `./net-bridge.ts` to the host, which still has
 *      Node and runs the same pinned provider as before. The isolate itself
 *      has no network stack, which makes the allowlist unbypassable from
 *      inside it.
 *   2. wasmoon's `glue.wasm` arrives as a URL on the job, because there is
 *      no `__dirname` here to find it beside the bundle.
 *
 * The protocol is the same one-job-in, one-result-out shape `run-host.ts`
 * expects, with net traffic interleaved: any message that is not a net
 * reply is the job.
 */
import {
  isRunJob,
  resultForInternalError,
  runJob,
  type RunJob,
  type RunResult,
} from './run-job.js';
import { createNetBridge } from './net-bridge-worker.js';
import type { NetBridgeRequest } from './net-bridge.js';

/** The Web Worker global surface this entry uses, named so the file typechecks without DOM lib types. */
interface WorkerGlobal {
  postMessage: (message: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (event: { data: unknown }) => void,
  ) => void;
}

declare const self: WorkerGlobal;

/**
 * A job for this entry additionally carries where `glue.wasm` can be
 * fetched from — a blob URL the host minted from the file on disk. Absent,
 * wasmoon falls back to its own resolution, which in a Web Worker will not
 * find anything; the host is expected to always send it.
 */
export interface BrowserRunJob extends RunJob {
  wasmUri?: string;
}

function start(scope: WorkerGlobal): void {
  const bridge = createNetBridge((message: NetBridgeRequest) => {
    scope.postMessage(message);
  });

  let running = false;

  scope.addEventListener('message', (event) => {
    const message: unknown = event.data;

    // Net replies arrive throughout the run; the bridge ignores anything
    // that is not one of its own.
    bridge.handleMessage(message);

    if (running) return;
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { kind?: unknown }).kind === 'markii:net-reply'
    ) {
      return;
    }
    running = true;

    void (async () => {
      if (!isRunJob(message)) {
        scope.postMessage(
          resultForInternalError(
            new Error('worker received a malformed job message'),
            {},
          ),
        );
        return;
      }
      const job = message as BrowserRunJob;
      let result: RunResult;
      try {
        result = await runJob(job, {
          createNet: () => bridge.provider,
          wasmUri: job.wasmUri,
          // GitHub issue #35: the same per-script message the Node entry
          // sends, on the same channel this worker posts its result on, so
          // ordering (progress before result) holds here too. Built in
          // `./run-job.ts`, never here.
          postProgress: (progress) => {
            scope.postMessage(progress);
          },
        });
      } catch (err) {
        result = resultForInternalError(err, job.cacheSnapshot ?? {});
      }
      scope.postMessage(result);
    })();
  });
}

// Guarded so importing this module in a test (or anywhere that is not a
// worker) is inert rather than throwing on a missing `self`.
if (
  typeof self !== 'undefined' &&
  typeof self.addEventListener === 'function'
) {
  start(self);
}

export { start as startBrowserWorker };
