/**
 * The `run` behavior's host-shaped seams, built from a `HostAdapter`:
 * this is where survey findings A1 and A6 stop being duplicated three
 * times over.
 *
 * A1: `apps/vscode/src/preview-panel.ts`'s `promptHostAdapter` /
 * `promptUnknownHostsAdapter` / `promptManyHostsAdapter`,
 * `apps/obsidian/src/run-modals.ts`'s `promptHostModal` /
 * `promptUnknownHostsModal` / `promptManyHostsModal`, and
 * `apps/cli/src/prompts.ts`'s three closures all did the same thing: call
 * one of `@markii/host`'s exported message builders and turn the answer
 * into a `boolean` through a host-specific UI primitive. `promptsFromAdapter`
 * below collapses all nine into three calls to the ONE `adapter.prompt`
 * method every `HostAdapter` already has.
 *
 * A6: `apps/vscode/src/preview-panel.ts:spawnRun` and
 * `apps/cli/src/run-note.ts:spawnRun` were the same five-line function —
 * the CLI's own doc comment said outright it was "mirroring
 * apps/vscode/src/preview-panel.ts's identical function". `spawnRunViaAdapter`
 * below is that function, written once, dispatching on `HostAdapter.isolate`'s
 * discriminated union instead of assuming a Node worker path.
 *
 * `runViaAdapter` composes both of these around `../run/run-flow.ts`'s
 * `runOnce` (the existing, already-shared grant-flow-plus-spawn
 * orchestration) and writes the `RunTrace` through `adapter.now()` rather
 * than `Date.now()`, so a fixed clock in a test fake makes the trace
 * byte-stable (batch 11 Phase 3's requirement).
 */
import type { RunTrigger } from '@markii/runtime';
import {
  ALLOW_LABEL,
  DONT_ALLOW_LABEL,
  UNKNOWN_HOSTS_PROMPT_MESSAGE,
  hostPromptMessage,
  manyHostsPromptMessage,
  type PromptHost,
  type PromptManyHosts,
  type PromptUnknownHosts,
} from '../run/grant-flow.js';
import {
  spawnRun as spawnRunHost,
  type RunResult,
  type SpawnRunOptions,
} from '../run/run-host.js';
import {
  runOnce,
  type RunOnceOptions,
  type RunOnceResult,
} from '../run/run-flow.js';
import { writeLastRunTrace, type RunTrace } from '../run/run-trace.js';
import { BROWSER_ISOLATE_ENTRY } from './adapter.js';
import type { HostAdapter, HostIsolate } from './adapter.js';

/**
 * External wall-clock budget for one run, matching the figure both
 * `apps/vscode` and `apps/cli` already used, so a note behaves the same
 * way under any host's watchdog.
 */
export const RUN_TIMEOUT_MS = 15_000;

/**
 * Builds the three grant prompts (`PromptHost`, `PromptUnknownHosts`,
 * `PromptManyHosts`) `../run/run-flow.ts`'s `runOnce` needs, each routed
 * through `adapter.prompt` with the exact wording `@markii/host`'s
 * message builders already produce. `consequential: true` on all three:
 * every one of them authorizes network access, so a host that can only
 * show a non-blocking surface must deny rather than assume yes — that
 * policy is the adapter's own (see `HostPromptRequest`'s doc comment).
 */
export function promptsFromAdapter(adapter: HostAdapter): {
  promptHost: PromptHost;
  promptUnknownHosts: PromptUnknownHosts;
  promptManyHosts: PromptManyHosts;
} {
  return {
    promptHost: (host, declaredHosts) =>
      adapter.prompt({
        kind: 'grant-host',
        message: hostPromptMessage(host, declaredHosts),
        allowLabel: ALLOW_LABEL,
        denyLabel: DONT_ALLOW_LABEL,
        consequential: true,
      }),
    promptUnknownHosts: () =>
      adapter.prompt({
        kind: 'grant-unknown-hosts',
        message: UNKNOWN_HOSTS_PROMPT_MESSAGE,
        allowLabel: ALLOW_LABEL,
        denyLabel: DONT_ALLOW_LABEL,
        consequential: true,
      }),
    promptManyHosts: (hostCount) =>
      adapter.prompt({
        kind: 'grant-many-hosts',
        message: manyHostsPromptMessage(hostCount),
        allowLabel: ALLOW_LABEL,
        denyLabel: DONT_ALLOW_LABEL,
        consequential: true,
      }),
  };
}

/**
 * A synthetic `RunResult` for a host with no `isolate` capability at all —
 * `spawnRunViaAdapter`'s never-throws contract extends to this case too:
 * a host that cannot run scripts reports it as an ordinary
 * `'capability-denied'` failure, not a thrown error.
 */
function noIsolateResult(
  cacheSnapshot: SpawnRunOptions['cacheSnapshot'],
): RunResult {
  return {
    values: {},
    failures: [
      {
        name: '<document>',
        message: 'this host has no isolate configured, so scripts cannot run.',
        kind: 'capability-denied',
      },
    ],
    cacheSnapshot,
  };
}

/**
 * The one `spawnRun` adapter every Node host (`apps/vscode`, `apps/cli`)
 * used to duplicate (survey A6), plus the browser-isolate path Obsidian's
 * own `spawnRun` wrapper needed. Dispatches on `HostIsolate`'s
 * discriminated union: a `'node'` host supplies only a worker path; a
 * `'browser'` host supplies an async, disposable `IsolateSpawner` factory,
 * disposed once this run's spawner has been used.
 */
export async function spawnRunViaAdapter(
  isolate: HostIsolate | undefined,
  options: Omit<SpawnRunOptions, 'workerPath' | 'spawnIsolate'>,
): Promise<RunResult> {
  if (!isolate) return noIsolateResult(options.cacheSnapshot);

  if (isolate.kind === 'node') {
    const workerPath = isolate.workerPath();
    // An undefined path is forwarded as absent, so `spawnRun` applies its
    // own development fallback instead of the host having to know about it.
    return spawnRunHost({
      ...options,
      ...(workerPath === undefined ? {} : { workerPath }),
    });
  }

  const spawner = await isolate.spawner();
  try {
    return await spawnRunHost({
      ...options,
      spawnIsolate: spawner,
      // A blob-URL Web Worker has no entry path, but `spawnRun` still
      // labels the entry it handed out, and its only fallback for an
      // unset one is the dev/Vitest path, which throws in a packaged
      // host. Naming the label here keeps that fallback out of the
      // browser branch entirely.
      workerPath: isolate.entryLabel ?? BROWSER_ISOLATE_ENTRY,
    });
  } finally {
    isolate.dispose();
  }
}

export interface RunViaAdapterRequest {
  /** Stable identity for the note this run belongs to. */
  readonly documentKey: string;
  readonly text: string;
  readonly trigger: RunTrigger;
  readonly netPolicy?: RunOnceOptions['netPolicy'];
  readonly bundle?: RunOnceOptions['bundle'];
  readonly packModules?: RunOnceOptions['packModules'];
  readonly onValue?: RunOnceOptions['onValue'];
  readonly timeoutMs?: number;
}

/**
 * Runs one manual, auto, or scheduled pass of `request.text`'s scripts,
 * exactly as `runOnce` already does (the grant flow prompts only on a
 * miss, and only for `'manual'`), but with every host-shaped input —
 * `spawnRun`, the three grant prompts, the memento, the last-run clock —
 * supplied from `adapter` instead of assembled ad hoc per app. Writes the
 * `RunTrace` through `writeLastRunTrace` using `adapter.now()`, never
 * `Date.now()` directly, so a fixed clock in a test fake makes the trace
 * byte-stable.
 */
export async function runViaAdapter(
  adapter: HostAdapter,
  request: RunViaAdapterRequest,
  overrideSpawnRun?: (options: SpawnRunOptions) => Promise<RunResult>,
): Promise<RunOnceResult> {
  const prompts = promptsFromAdapter(adapter);
  const spawn =
    overrideSpawnRun ??
    ((options: SpawnRunOptions): Promise<RunResult> =>
      spawnRunViaAdapter(adapter.isolate, options));

  const result = await runOnce({
    documentKey: request.documentKey,
    text: request.text,
    trigger: request.trigger,
    memento: adapter.memento,
    ...prompts,
    spawnRun: spawn,
    timeoutMs: request.timeoutMs ?? RUN_TIMEOUT_MS,
    ...(request.netPolicy !== undefined
      ? { netPolicy: request.netPolicy }
      : {}),
    ...(request.bundle !== undefined ? { bundle: request.bundle } : {}),
    ...(request.packModules !== undefined
      ? { packModules: request.packModules }
      : {}),
    ...(request.onValue !== undefined ? { onValue: request.onValue } : {}),
  });

  const trace: RunTrace = {
    trigger: request.trigger,
    ranAt: adapter.now(),
    ok: result.failures.length === 0,
    ...(result.failures.length > 0
      ? {
          reason: `${result.failures.length} script${result.failures.length === 1 ? '' : 's'} failed`,
        }
      : {}),
  };
  // Best-effort, matching both apps' own posture: a trace-write failure
  // must never turn a successful (or already-reported) run into a thrown
  // error.
  await writeLastRunTrace(adapter.memento, request.documentKey, trace).then(
    undefined,
    () => {},
  );

  return result;
}
