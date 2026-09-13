/**
 * The run path: builds `@markii/host`'s `RunOnceOptions` and calls
 * `runOnce`, the same shared, security-critical run path both GUI hosts
 * use. This module owns none of the sandboxing, grant policy, or tier
 * gating itself — all of that lives in `@markii/host`; this module only
 * supplies the CLI's own seams (the worker path, the terminal prompts, and
 * the bundle read/write adapters).
 */
import { pathToFileURL } from 'node:url';
import {
  runOnce,
  spawnRun as spawnRunHost,
  buildBundleSnapshot,
  writeLastRunTrace,
  type GrantMemento,
  type RunOnceOptions,
  type RunOnceResult,
  type RunTrace,
  type SpawnRunOptions,
  type RunResult,
} from '@markii/host';
import { openDirBundle } from '@markii/bundle/fs';
import type { ResolvedNote } from './read-note.js';
import { createTerminalPrompts } from './prompts.js';
import type { Terminal } from './terminal.js';
import { resolveWorkerPath } from './worker-path.js';

/**
 * External wall-clock budget for one run, matching `apps/vscode`'s own
 * manual-run budget (`RUN_TIMEOUT_MS` in `preview-panel.ts`) — the same
 * figure, so a note behaves the same way under either host's watchdog.
 */
export const RUN_TIMEOUT_MS = 15_000;

/**
 * This CLI's own `spawnRun` adapter, mirroring `apps/vscode/src/preview-panel.ts`'s
 * identical function: `@markii/host`'s `spawnRun` takes an explicit
 * `workerPath` rather than guessing a host's bundle layout, and
 * `./worker-path.ts`'s `resolveWorkerPath` is this CLI's answer for the
 * packaged case.
 */
function spawnRun(options: SpawnRunOptions): Promise<RunResult> {
  return spawnRunHost({
    ...options,
    workerPath: options.workerPath ?? resolveWorkerPath(),
  });
}

function bundleOptionsFor(
  bundle: NonNullable<ResolvedNote['bundle']>,
  onDiagnosticLine: (line: string) => void,
): NonNullable<RunOnceOptions['bundle']> {
  if (bundle.form === 'directory' && bundle.rootDir !== undefined) {
    const rootDir = bundle.rootDir;
    return {
      manifest: bundle.manifest,
      buildSnapshot: async () => {
        const { files } = await buildBundleSnapshot(openDirBundle(rootDir));
        return files;
      },
      persistCacheOut: async (cacheOut) => {
        const storage = openDirBundle(rootDir);
        for (const [path, bytes] of Object.entries(cacheOut)) {
          await storage.write(path, bytes);
        }
      },
    };
  }

  // The zip form is read-only: there is no file on disk to write a
  // `.cache/` update back into. The run's values still feed this process's
  // render (`RunOnceResult.values` covers that), but nothing is persisted
  // across invocations for a `.mkz` note. Said once, under --verbose, per
  // this module's contract with its caller.
  return {
    manifest: bundle.manifest,
    buildSnapshot: async () => {
      const { files } = await buildBundleSnapshot(bundle.storage);
      return files;
    },
    persistCacheOut: async () => {
      onDiagnosticLine(
        'this note is a read-only .mkz bundle: run values are kept in memory for this process only, not written back to the file.',
      );
    },
  };
}

export interface RunNoteOptions {
  /** The note's absolute file path — the caller resolves this (`path.resolve`), so this module never has to reason about the working directory itself. */
  readonly absolutePath: string;
  readonly note: ResolvedNote;
  readonly terminal: Terminal;
  readonly memento: GrantMemento;
  /** Called for anything worth telling the user about that isn't a run failure itself — the non-interactive-prompt notice and the read-only-bundle notice. */
  readonly onDiagnosticLine?: (line: string) => void;
}

/** Runs `note`'s scripts once, at the manual tier, through the shared run path. Never throws — `@markii/host`'s `runOnce`/`spawnRun` already guarantee that. */
export async function runNote(options: RunNoteOptions): Promise<RunOnceResult> {
  const { absolutePath, note, terminal, memento } = options;
  const onDiagnosticLine = options.onDiagnosticLine ?? ((): void => {});
  const documentKey = pathToFileURL(absolutePath).toString();
  const prompts = createTerminalPrompts(terminal, onDiagnosticLine);

  const result = await runOnce({
    documentKey,
    text: note.text,
    trigger: 'manual',
    memento,
    promptHost: prompts.promptHost,
    promptUnknownHosts: prompts.promptUnknownHosts,
    promptManyHosts: prompts.promptManyHosts,
    spawnRun,
    timeoutMs: RUN_TIMEOUT_MS,
    ...(note.bundle
      ? { bundle: bundleOptionsFor(note.bundle, onDiagnosticLine) }
      : {}),
  });

  const trace: RunTrace = {
    trigger: 'manual',
    ranAt: Date.now(),
    ok: result.failures.length === 0,
    ...(result.failures.length > 0
      ? {
          reason: `${result.failures.length} script${result.failures.length === 1 ? '' : 's'} failed`,
        }
      : {}),
  };
  await writeLastRunTrace(memento, documentKey, trace);

  return result;
}

/** Whether this run's result should make the CLI exit 2 (a script failed). */
export function scriptsFailed(result: RunOnceResult): boolean {
  return result.failures.length > 0;
}
