/**
 * The host-side runner for slice 1 of the extension's v2 Run arc (GitHub
 * issue #1's locked design comment). Plain Node — no `vscode` import — so
 * it is unit-testable with Vitest and reusable unchanged once slice 2
 * wires a command/button to it.
 *
 * `spawnRun` is the whole contract: give it a note's text, its net
 * allowlist, a persisted cache snapshot, and a deadline; get back a
 * `RunResult` that never rejects. The EXTERNAL watchdog
 * (`setTimeout` -> `worker.terminate()`) is what makes this safe to call
 * against untrusted script content — `./worker-entry.ts`'s own in-VM
 * limits are a second, INNER layer (docs/security.md), but this file's job
 * is the outer one: a kill switch that works even if everything inside the
 * worker is compromised or wedged, because `terminate()` acts on the
 * thread from outside it.
 */
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import type { CacheEntry } from '@markii/lua';
import type { RunTrigger } from '@markii/runtime';
import type { RunJob, RunResult } from './worker-entry.js';
import type { IsolateSpawner, RunIsolate } from './isolate.js';

export type {
  IsolateSpawner,
  RunIsolate,
  SpawnIsolateOptions,
} from './isolate.js';

export type { RunJob, RunResult, RunFailure } from './worker-entry.js';

export interface SpawnRunOptions {
  text: string;
  /**
   * How this run was triggered (GitHub issue #11), forwarded verbatim to the
   * worker's `RunJob.trigger` and, from there, to `runDocumentScripts` — the
   * value that `@markii/runtime`'s `tierForTrigger` maps to the execution
   * tier THE SANDBOX ENFORCES. `'manual'` unlocks every granted capability;
   * `'auto'`/`'scheduled'` are read-only regardless of what was granted.
   * Omitted defaults to `'manual'` in the worker, preserving the pre-#11
   * behavior for any caller that has not been updated.
   */
  trigger?: RunTrigger;
  netAllowlist: string[];
  /**
   * The DNS-rebinding / private-range policy (GitHub issue #10), forwarded
   * verbatim to the worker's `RunJob.netPolicy` — see `./net-pinning.ts`'s
   * `PinPolicy` and `./worker-entry.ts`'s `createNetProvider`. Omitted
   * defaults to the fail-closed posture in the worker
   * (`allowRestrictedAddresses: false`), same pattern `trigger` and
   * `packModules` already follow.
   */
  netPolicy?: RunJob['netPolicy'];
  cacheSnapshot: Record<string, CacheEntry>;
  /** Wall-clock budget for the whole run, enforced by this file's own external watchdog — never delegated to the worker. */
  timeoutMs: number;
  /** Forwarded verbatim to the worker's `RunJob.limits` (the sandbox's own, INNER resource caps) — see `./worker-entry.ts`. */
  limits?: RunJob['limits'];
  /** Forwarded verbatim to the worker's `RunJob.bundle` (the bundle-fs capability snapshot) — see `./worker-entry.ts`. Absent for a bare `.mk.md` run. */
  bundle?: RunJob['bundle'];
  /** Forwarded verbatim to the worker's `RunJob.packModules` (pre-read pack Lua modules) — see `./worker-entry.ts`. Absent when no packs are configured. */
  packModules?: RunJob['packModules'];
  /**
   * Overrides the KIND of isolate this run spawns. Defaults to
   * `workerThreadIsolate` (`node:worker_threads`), which is correct for
   * every Node host. A host whose runtime cannot create worker threads —
   * an Electron renderer, which is what an Obsidian plugin runs in —
   * supplies its own; see `./isolate.ts` for the constraints an
   * implementation must meet, and for what a Web Worker cannot bound that
   * a worker thread can.
   *
   * The watchdog, the exactly-once settlement, and the never-rejects
   * contract are NOT part of what this overrides: they stay in `spawnRun`
   * for every host, so a new isolate kind cannot accidentally ship without
   * a kill switch.
   */
  spawnIsolate?: IsolateSpawner;
  /**
   * Overrides the worker entry file this run spawns. This package cannot
   * know how a given host bundles or lays out its own `dist/` (that is
   * host-specific — see e.g. `apps/vscode/esbuild.config.mjs`'s worker
   * build and `apps/vscode/src/worker-path.ts`), so a real host is
   * expected to always pass this explicitly. Left unset, `defaultWorkerPath`
   * falls back to the sibling `worker-entry.ts` run straight from source
   * via `tsx` — a convenience for this package's own dev/Vitest runs, not
   * a general-purpose default for a packaged host.
   */
  workerPath?: string;
}

/** `execArgv` needed to run a `.ts` worker entry directly (dev/Vitest only) — see `./worker-entry.ts`'s doc comment on why a plain `node` `.ts` import can't resolve this repo's `@markii/*` bare specifiers or its `./foo.js` -> `./foo.ts` import convention on its own. `--require tsx/cjs` (rather than `tsx/esm`) is deliberate: empirically, the ESM loader hook deadlocks Node's CJS/ESM interop translator for a worker thread requiring `.js`-suffixed relative imports that resolve to `.ts` files (this repo's convention throughout `@markii/*`), while the CJS `require` hook has no such issue. */
const TSX_DEV_EXEC_ARGV = ['--require', 'tsx/cjs'];

/**
 * The ONLY fallback this shared package supplies for an unset `workerPath`:
 * the sibling `worker-entry.ts`, run straight from source via `tsx`
 * (`TSX_DEV_EXEC_ARGV`, above). That is correct for this package's own
 * dev/Vitest runs — `__dirname` at that point is this real source
 * directory — but it says nothing about where a packaged host's bundled
 * worker lives, because this package does not know that host's `dist/`
 * layout. A packaged host (e.g. `apps/vscode`) MUST resolve its own bundled
 * worker path itself and pass it as `SpawnRunOptions.workerPath`; see
 * `apps/vscode/src/worker-path.ts` for that host's resolution and
 * `apps/vscode/esbuild.config.mjs`'s worker build for where it bundles to.
 */
export function defaultWorkerPath(): string {
  const devSource = path.join(__dirname, 'worker-entry.ts');
  if (existsSync(devSource)) return devSource;

  throw new Error(
    'spawnRun: could not resolve the worker entry file (looked for ' +
      `${devSource}) — pass workerPath explicitly`,
  );
}

function execArgvFor(workerPath: string): string[] | undefined {
  return workerPath.endsWith('.ts') ? TSX_DEV_EXEC_ARGV : undefined;
}

/**
 * `resourceLimits.maxOldGenerationSizeMb` for the spawned worker (A-1): a
 * script's own Lua memory is already capped in-VM (`@markii/lua`'s
 * `limits.maxMemoryBytes`), but nothing previously bounded the JS/V8 heap
 * OF THE WORKER ITSELF — a large marshaled return value, an oversize
 * fetched/cached JSON payload, or any other JS-side allocation this file's
 * own code performs could still OOM that heap. Without an explicit
 * `resourceLimits`, a V8 OOM inside a `worker_threads` worker is fatal to
 * the WHOLE PROCESS (the extension host), not just that thread — exactly
 * the failure mode the external, always-available `terminate()` watchdog
 * above is meant to make impossible for a wedged/hostile script. 128MB is
 * comfortably above what one script's marshaled result or one cached
 * fetch response (`@markii/lua`'s `DEFAULT_MAX_FETCH_BYTES`, 2MB) should
 * ever need, while still being small enough that a runaway allocation hits
 * this cap, and the resulting worker `'error'` event, long before it could
 * threaten the host process's own heap.
 */
const WORKER_MAX_OLD_GENERATION_SIZE_MB = 128;

/**
 * The default isolate: a `node:worker_threads` worker, which is what every
 * Node host (the VS Code extension host, this package's own tests) uses. It
 * is the only kind that accepts `resourceLimits`, so it is also the only
 * kind whose V8 heap is bounded — see `./isolate.ts` for why a host might
 * still have to supply the other one.
 */
export const workerThreadIsolate: IsolateSpawner = (options): RunIsolate => {
  const worker = new Worker(options.entryPath, {
    ...(options.execArgv ? { execArgv: options.execArgv } : {}),
    resourceLimits: {
      maxOldGenerationSizeMb: options.maxOldGenerationSizeMb,
    },
  });
  return {
    send: (job) => {
      worker.postMessage(job);
    },
    kill: () => {
      void worker.terminate();
    },
    onMessage: (listener) => {
      worker.once('message', listener);
    },
    onError: (listener) => {
      worker.once('error', listener);
    },
    onExit: (listener) => {
      worker.once('exit', listener);
    },
  };
};

function describeThrown(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Spawns one ephemeral worker, runs `options.text`'s scripts in it under
 * the manual tier, and resolves with the outcome. NEVER REJECTS — every
 * way this can go wrong (a message never arrives, the worker throws, the
 * worker exits on its own, the external watchdog fires) resolves with an
 * ordinary `RunResult` carrying a synthetic failure instead. Settlement is
 * exactly-once: whichever of `message` / `error` / `exit` / the watchdog
 * fires FIRST wins; every later event on the same worker is a no-op (the
 * `settled` guard below), so there is no risk of a double-`resolve` race
 * even though several of these could in principle fire in close
 * succession (e.g. `terminate()` after settling on `message` still
 * produces its own `exit` event).
 */
export async function spawnRun(options: SpawnRunOptions): Promise<RunResult> {
  const workerPath = options.workerPath ?? defaultWorkerPath();
  const execArgv = execArgvFor(workerPath);

  const job: RunJob = {
    text: options.text,
    netAllowlist: options.netAllowlist,
    cacheSnapshot: options.cacheSnapshot,
    ...(options.trigger !== undefined ? { trigger: options.trigger } : {}),
    ...(options.netPolicy !== undefined
      ? { netPolicy: options.netPolicy }
      : {}),
    ...(options.limits !== undefined ? { limits: options.limits } : {}),
    ...(options.bundle !== undefined ? { bundle: options.bundle } : {}),
    ...(options.packModules !== undefined
      ? { packModules: options.packModules }
      : {}),
  };

  return new Promise<RunResult>((resolve) => {
    let settled = false;
    let watchdogFired = false;

    const spawnIsolate = options.spawnIsolate ?? workerThreadIsolate;
    const worker = spawnIsolate({
      entryPath: workerPath,
      ...(execArgv ? { execArgv } : {}),
      maxOldGenerationSizeMb: WORKER_MAX_OLD_GENERATION_SIZE_MB,
    });

    function watchdogFailure(): RunResult {
      return {
        values: {},
        failures: [
          {
            name: '<document>',
            message: `run exceeded its ${options.timeoutMs}ms watchdog and was terminated`,
            kind: 'limit',
          },
        ],
        cacheSnapshot: options.cacheSnapshot,
      };
    }

    const watchdog = setTimeout(() => {
      watchdogFired = true;
      // Fire-and-forget: `terminate()`'s own returned promise resolves
      // once the thread is actually gone, but we don't need to wait on
      // it here -- the worker's `exit` event (handled below) is what
      // settles this run's promise, and it fires as part of the same
      // termination sequence.
      worker.kill();
      // ...except where there IS no exit event to wait for. A Web Worker's
      // `terminate()` is immediate and silent, so a host using one would
      // otherwise hang here forever, having killed the isolate and then
      // waited for a notification that never comes. Settling directly is
      // correct for both kinds: a worker thread's `exit` still arrives and
      // is a no-op against `settled`, and this run's outcome does not
      // depend on how promptly the runtime reports the death of something
      // already terminated.
      settle(watchdogFailure());
    }, options.timeoutMs);
    // Never let this timer keep the host process/extension-host alive on
    // its own.
    watchdog.unref?.();

    function settle(result: RunResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve(result);
      // Ephemeral-per-run: tear the worker down once we have ANY outcome,
      // including a normal successful `message`. `terminate()` on a
      // worker that has already exited (or is already exiting) is a safe
      // no-op, per Node's `worker_threads` documentation.
      worker.kill();
    }

    worker.onMessage((result) => {
      settle(result as RunResult);
    });

    worker.onError((err) => {
      settle({
        values: {},
        failures: [
          {
            name: '<worker>',
            message: describeThrown(err),
            kind: 'script-error',
          },
        ],
        cacheSnapshot: options.cacheSnapshot,
      });
    });

    worker.onExit((code) => {
      // A `message` already having settled this run is the ordinary
      // happy path -- `settle`'s own `terminate()` call produces exactly
      // this `exit` event, and `settle`'s guard makes it a no-op here.
      if (settled) return;

      if (watchdogFired) {
        settle(watchdogFailure());
        return;
      }

      // The worker exited on its own, without the watchdog and without
      // ever posting a result -- e.g. a hostile/rigged script that calls
      // `process.exit()` directly (Node terminates only the calling
      // worker thread for that, not the host process, but this run still
      // never got a proper `RunResult` out of it). Resolve, never
      // reject -- see this function's doc comment.
      settle({
        values: {},
        failures: [
          {
            name: '<worker>',
            message: `worker exited unexpectedly (code ${String(code)}) before returning a result`,
            kind: 'script-error',
          },
        ],
        cacheSnapshot: options.cacheSnapshot,
      });
    });

    // N-2 fix (docs/archive/PENTEST-REPORT-2026-08-23.md): `postMessage` structured-clones
    // `job` synchronously, so an uncloneable payload (e.g. a value containing
    // a function, or an object with a throwing `toString`) throws a
    // `DataCloneError` right here, before any of the worker's own event
    // handlers above have a chance to settle this promise. Left unguarded,
    // that throw would propagate out of the executor and REJECT `spawnRun`'s
    // promise, breaking its documented never-rejects contract. Route it
    // through the same synthetic-failure `settle` path as every other
    // failure mode instead, and let `settle`'s own `terminate()` clean up the
    // worker that was already spawned (a safe no-op if the thread never
    // finished starting).
    try {
      worker.send(job);
    } catch (err) {
      settle({
        values: {},
        failures: [
          {
            name: '<document>',
            message: `run could not be started: ${describeThrown(err)}`,
            kind: 'script-error',
          },
        ],
        cacheSnapshot: options.cacheSnapshot,
      });
    }
  });
}
