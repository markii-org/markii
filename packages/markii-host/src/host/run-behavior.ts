/**
 * The `run` behavior's host-shaped seams, built from a `HostAdapter`:
 * the grant prompts and the isolate spawn live here once for every host.
 *
 * `promptsFromAdapter` routes the three grant prompts through the one
 * `adapter.prompt` method every `HostAdapter` has, so a host writes no
 * per-prompt code. Each prompt carries the wording the grant flow's message
 * builders produce.
 *
 * `spawnRunViaAdapter` starts the run in the isolate the adapter names. It
 * dispatches on `HostIsolate`'s discriminated union, so a Node worker path
 * and a browser spawner go through the same call.
 *
 * `runViaAdapter` composes both around `../run/run-flow.ts`'s `runOnce`,
 * the shared grant-flow-plus-spawn orchestration. It writes the `RunTrace`
 * through `adapter.now()` rather than `Date.now()`, so a fixed clock in a
 * test fake makes the trace byte-stable.
 */
import {
  ALLOW_LABEL,
  DONT_ALLOW_LABEL,
  hostPromptMessage,
  manyHostsPromptMessage,
  unknownHostsPromptMessage,
  type PromptHost,
  type PromptManyHosts,
  type PromptUnknownHosts,
} from '../run/grant-flow.js';
import {
  spawnRun as spawnRunHost,
  type RunResult,
  type SpawnRunRequest,
} from '../run/run-host.js';
import { runOnce, type RunOnceResult } from '../run/run-flow.js';
import { writeLastRunTrace, type RunTrace } from '../run/run-trace.js';
import {
  runCrashDiagnosticLine,
  runDiagnosticLines,
} from './run-diagnostics.js';
import type { RunRequest } from './create-host.js';
import { BROWSER_ISOLATE_ENTRY } from './adapter.js';
import type { HostAdapter, HostIsolate } from './adapter.js';
import { noteNounOf } from './labels.js';

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
  const noteNoun = noteNounOf(adapter.labels);
  return {
    promptHost: (host, declaredHosts) =>
      adapter.prompt({
        kind: 'grant-host',
        host,
        declaredHosts,
        message: hostPromptMessage(host, declaredHosts, noteNoun),
        allowLabel: ALLOW_LABEL,
        denyLabel: DONT_ALLOW_LABEL,
        consequential: true,
      }),
    promptUnknownHosts: (hosts) =>
      adapter.prompt({
        kind: 'grant-unknown-hosts',
        hosts,
        message: unknownHostsPromptMessage(noteNoun),
        allowLabel: ALLOW_LABEL,
        denyLabel: DONT_ALLOW_LABEL,
        consequential: true,
      }),
    promptManyHosts: (hosts) =>
      adapter.prompt({
        kind: 'grant-many-hosts',
        hosts,
        message: manyHostsPromptMessage(hosts.length, noteNoun),
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
  cacheSnapshot: SpawnRunRequest['cacheSnapshot'],
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

/** A synthetic `RunResult` for a node isolate whose worker file cannot be located. The run never throws. */
function workerMissingResult(
  cacheSnapshot: SpawnRunRequest['cacheSnapshot'],
  error: unknown,
): RunResult {
  return {
    values: {},
    failures: [
      {
        name: '<document>',
        message: `the script worker could not be located: ${
          error instanceof Error ? error.message : String(error)
        }`,
        kind: 'capability-denied',
      },
    ],
    cacheSnapshot,
  };
}

/**
 * The one `spawnRun` adapter every Node host (`apps/vscode`, `apps/cli`)
 * needs, plus the browser-isolate path Obsidian's
 * own `spawnRun` wrapper needed. Dispatches on `HostIsolate`'s
 * discriminated union: a `'node'` host supplies only a worker path; a
 * `'browser'` host supplies an async, disposable `IsolateSpawner` factory,
 * disposed once this run's spawner has been used.
 */
export async function spawnRunViaAdapter(
  isolate: HostIsolate | undefined,
  options: SpawnRunRequest,
): Promise<RunResult> {
  if (!isolate) return noIsolateResult(options.cacheSnapshot);

  if (isolate.kind === 'node') {
    let workerPath: string;
    try {
      workerPath = isolate.workerPath();
    } catch (error) {
      return workerMissingResult(options.cacheSnapshot, error);
    }
    return spawnRunHost({
      ...options,
      workerPath,
      spawnIsolate: isolate.spawnIsolate,
    });
  }

  const spawner = await isolate.spawner();
  try {
    return await spawnRunHost({
      ...options,
      spawnIsolate: spawner,
      // A blob-URL Web Worker has no entry path, but `spawnRun` still
      // labels the entry it handed out. Naming the label here keeps a
      // meaningless path out of the browser branch.
      workerPath: isolate.entryLabel ?? BROWSER_ISOLATE_ENTRY,
    });
  } finally {
    isolate.dispose();
  }
}

/** A run's result plus the `RunTrace` it just recorded, so a host can show its in-note marker from the same value the shared path persisted. */
export type RunViaAdapterResult = RunOnceResult & {
  readonly trace: RunTrace;
  /** How many of this run's values came back with the value store's `fresh` status. */
  readonly freshCount: number;
  /** How many of this run's values came back with the value store's `error` status. */
  readonly errorCount: number;
};

/** What one run produced: the result, or the reason it could not complete. Never thrown. */
export type RunAttemptOutcome =
  | ({ readonly kind: 'ran' } & RunViaAdapterResult)
  | { readonly kind: 'failed'; readonly reason: string };

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
  request: RunRequest,
  overrideSpawnRun?: (options: SpawnRunRequest) => Promise<RunResult>,
): Promise<RunAttemptOutcome> {
  const prompts = promptsFromAdapter(adapter);
  const spawn =
    overrideSpawnRun ??
    ((options: SpawnRunRequest): Promise<RunResult> =>
      spawnRunViaAdapter(adapter.isolate, options));

  let result: RunOnceResult;
  try {
    result = await runOnce({
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
  } catch (err) {
    // A run that threw is still a failure with two homes: the diagnostics
    // line and a failed trace for the in-note marker. The caller gets the
    // reason as a `failed` outcome and keeps its own visible surface.
    const detail = err instanceof Error ? err.message : String(err);
    adapter.diagnostics(runCrashDiagnosticLine(request.trigger, detail));
    await writeLastRunTrace(adapter.memento, request.documentKey, {
      trigger: request.trigger,
      ranAt: adapter.now(),
      ok: false,
      reason: detail,
    }).then(undefined, () => {});
    return { kind: 'failed', reason: detail };
  }

  // The failure's second home (AGENTS.md, "clean is not silent"): one line
  // per failed script and per declaration mismatch, written here once so no
  // host can forget it.
  for (const line of runDiagnosticLines(request.trigger, result)) {
    adapter.diagnostics(line);
  }

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

  let freshCount = 0;
  let errorCount = 0;
  for (const value of Object.values(result.values)) {
    if (value.status === 'fresh') freshCount += 1;
    else if (value.status === 'error') errorCount += 1;
  }

  return { kind: 'ran', ...result, trace, freshCount, errorCount };
}
