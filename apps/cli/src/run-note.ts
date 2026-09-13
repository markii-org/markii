/**
 * The run path: builds the CLI's `HostAdapter` (`./host-adapter.ts`) and
 * calls `createMarkiiHost(adapter).run(...)`, the same shared,
 * security-critical run path every host now goes through. This module
 * owns none of the sandboxing, grant policy, tier gating, or spawn
 * wiring itself — all of that lives in `@markii/host`; this module only
 * supplies the CLI's own seams (the bundle read/write adapters) and
 * shapes the outcome back into the plain `RunOnceResult` its callers
 * already expect.
 */
import { pathToFileURL } from 'node:url';
import {
  buildBundleSnapshot,
  createMarkiiHost,
  type GrantMemento,
  type RunOnceOptions,
  type RunOnceResult,
} from '@markii/host';
import { openDirBundle } from '@markii/bundle/fs';
import type { ResolvedNote } from './read-note.js';
import { createCliHostAdapter } from './host-adapter.js';
import type { Terminal } from './terminal.js';

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

/**
 * A run outcome for a host whose `isolate` capability is somehow missing.
 * Never expected in practice — this CLI always declares `isolate` — but
 * kept so `runNote`'s return type stays the plain `RunOnceResult` every
 * caller already expects, rather than the wider `RunOutcome` union.
 */
function unsupportedRunResult(detail: string | undefined): RunOnceResult {
  const message = detail ?? 'this host has no isolate configured.';
  return {
    values: {},
    failures: [{ name: '<document>', kind: 'capability-denied' }],
    failureDetails: [
      { name: '<document>', kind: 'capability-denied', message },
    ],
    netDeclarationDiagnostics: [],
  };
}

/** Runs `note`'s scripts once, at the manual tier, through the shared run path. Never throws — `@markii/host`'s `createMarkiiHost`/`runOnce` already guarantee that. */
export async function runNote(options: RunNoteOptions): Promise<RunOnceResult> {
  const { absolutePath, note, terminal, memento } = options;
  const onDiagnosticLine = options.onDiagnosticLine ?? ((): void => {});
  const documentKey = pathToFileURL(absolutePath).toString();

  const adapter = createCliHostAdapter({
    terminal,
    memento,
    diagnostics: onDiagnosticLine,
  });
  const host = createMarkiiHost(adapter);

  const outcome = await host.run({
    documentKey,
    text: note.text,
    trigger: 'manual',
    ...(note.bundle
      ? { bundle: bundleOptionsFor(note.bundle, onDiagnosticLine) }
      : {}),
  });

  if (outcome.kind === 'unsupported') {
    return unsupportedRunResult(outcome.detail);
  }
  const { kind: _kind, ...result } = outcome;
  return result;
}

/** Whether this run's result should make the CLI exit 2 (a script failed). */
export function scriptsFailed(result: RunOnceResult): boolean {
  return result.failures.length > 0;
}
