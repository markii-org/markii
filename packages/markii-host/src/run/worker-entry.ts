/**
 * The `worker_thread` entry point for slice 1 of the extension's v2 Run
 * arc (docs: GitHub issue #1's locked design comment). This file is
 * vscode-free — it never imports `vscode` and knows nothing about VS
 * Code's API — so it can be unit-tested directly with Vitest (spawned as a
 * REAL `node:worker_threads` worker, exercising the real wasmoon sandbox)
 * and, unmodified, be the bundled worker `esbuild.config.mjs` produces for
 * the packaged extension.
 *
 * ## Why a whole worker per run
 *
 * The design (docs/security.md's isolate requirement) is "one ephemeral
 * worker per run": the host spawns a fresh thread, this file boots
 * `@markii/lua` + `@markii/runtime` once, runs exactly one batch, posts
 * back one progress message per script and then exactly one result
 * message, and the whole thread is expected to be
 * torn down by the host afterward (`run-host.ts`) regardless of how this
 * run went. That is what makes the external wall-clock watchdog
 * (`worker.terminate()`) an unconditional, always-available kill switch:
 * it can never be blocked by anything this file's own code does, because
 * `terminate()` acts on the OS/V8 thread itself, not on anything
 * cooperative running inside it.
 *
 * ## Never an unhandled rejection
 *
 * Every path through `main()` below is wrapped so that ANY failure —
 * a malformed job message, `parse()` throwing on pathological input,
 * `runDocumentScripts` itself misbehaving — becomes an ordinary result
 * message carrying a synthetic failure, never a thrown/rejected error that
 * could surface as an "Unhandled Promise Rejection" on the worker thread
 * (which Node would otherwise report noisily, or in the worst case treat
 * as fatal depending on the host's process-wide `--unhandled-rejections`
 * setting). `run-host.ts` therefore never needs an `unhandledRejection`
 * listener on the worker to stay safe.
 */
import { parentPort } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import { netProviderDenial } from '@markii/lua';
import { createNetProvider } from './net-provider.js';

// The job/result shapes and the run itself moved to `./run-job.ts` when
// the Obsidian host forced a second, non-Node isolate (see that file's doc
// comment). They are re-exported here because `run-host.ts` and both
// worker entries have always imported them from this module, and a rename
// would be churn with no reader benefit.
export type { RunJob, RunFailure, RunProgress, RunResult } from './run-job.js';
import { isRunJob, resultForInternalError, runJob } from './run-job.js';

/**
 * Resolves the `wasmUri` to hand `createLuaExecutor` (forwarded to
 * `@markii/lua`'s `runScript` -> `createEmptyLuaEngine` -> wasmoon's
 * `LuaFactory`). In the BUNDLED extension, `esbuild.config.mjs`'s worker
 * build copies wasmoon's `glue.wasm` next to this file's compiled output
 * (`dist/run/glue.wasm`) specifically so this lookup succeeds; in
 * dev/Vitest (this file run straight from `src/run/`, no copy step has
 * ever run), the file is absent and `undefined` is returned, letting
 * wasmoon fall back to its own default Node resolution (the real
 * `node_modules/wasmoon/dist/glue.wasm`) — see `@markii/lua`'s
 * `createEmptyLuaEngine` doc comment for why `undefined` is always safe to
 * pass here.
 */
function resolveWasmUri(): string | undefined {
  const candidate = path.join(__dirname, 'glue.wasm');
  return existsSync(candidate) ? candidate : undefined;
}

async function main(): Promise<void> {
  if (!parentPort) {
    // Not actually running as a worker thread (e.g. required directly by
    // mistake) — nothing to do, and nothing to post a result to.
    return;
  }
  const port = parentPort;

  port.once('message', (message: unknown) => {
    void (async () => {
      if (!isRunJob(message)) {
        port.postMessage(
          resultForInternalError(
            new Error('worker received a malformed job message'),
            {},
          ),
        );
        return;
      }
      try {
        const result = await runJob(message, {
          // GitHub issue #35: one message per script, on the SAME port the
          // final result goes out on, so the host receives them in order
          // and always ahead of the result. Identical to what
          // `./worker-entry-browser.ts` does; the message itself is built
          // in `./run-job.ts` so the two cannot drift.
          postProgress: (progress) => {
            port.postMessage(progress);
          },
          // The Lua brand is supplied HERE, where the runtime is already
          // present, rather than imported by the provider itself — see
          // `./net-provider.ts`'s doc comment.
          createNet: (allowlist, maxFetchBytes, policy) =>
            createNetProvider(
              allowlist,
              maxFetchBytes,
              policy,
              netProviderDenial,
            ),
          wasmUri: resolveWasmUri(),
        });
        port.postMessage(result);
      } catch (err) {
        port.postMessage(
          resultForInternalError(err, message.cacheSnapshot ?? {}),
        );
      }
    })();
  });
}

void main();
