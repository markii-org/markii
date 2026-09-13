/**
 * The CLI's `HostAdapter` (batch 11): built from injected dependencies
 * only — the terminal IO seam, the device-local grant store, and
 * (optionally) a clock and an export destination — never reading
 * `process`/`env`/argv itself. `main.ts` and `terminal.ts` stay the only
 * modules that do that (AGENTS.md); this module takes what it needs as
 * plain arguments so it stays constructible over a fake in a test.
 *
 * Capabilities declared, and why:
 * - `isolate`: the `'node'` kind. `./worker-path.ts`'s `resolveWorkerPath`
 *   resolves the packaged CLI's bundled worker; `@markii/host`'s
 *   `defaultWorkerPath` is the dev/Vitest fallback, exactly as this app's
 *   old `run-note.ts:spawnRun` wrapper already relied on.
 * - `exports`: `html`, `ansi`, and `md-plain`. Never `pdf` — there is no
 *   `BrowserWindow` in a terminal process to print through.
 * - `editor`: NOT declared. A one-shot terminal command has no cursor and
 *   no live edit surface to complete, hover, or insert into.
 * - `packs`: NOT declared. AGENTS.md is explicit: "Loads no packs by
 *   design: a pack directive renders as the unknown component fallback."
 *   Declaring an empty pack source only to satisfy the type would be
 *   exactly the fake-capability pattern the batch 11 design warns
 *   against; omitting it lets `createMarkiiHost`'s pack behaviors report
 *   the honest `Unsupported` outcome instead.
 *
 * The prompt policy: with no TTY on stdin, `prompt` DENIES without asking
 * — a grant cannot be given non-interactively, and there is no `--yes`
 * flag to bypass that. The reason reaches `diagnostics` at most once per
 * adapter instance, so a scripted invocation is not left silently
 * wondering why nothing was granted (AGENTS.md's "clean is not silent").
 */
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import {
  CLI_LABELS,
  defaultWorkerPath,
  type GrantMemento,
  type HostAdapter,
  type HostDirEntry,
  type HostExportFormat,
  type HostPromptRequest,
} from '@markii/host';
import type { Terminal } from './terminal.js';
import { resolveWorkerPath } from './worker-path.js';

const PROMPT_SUFFIX = ' [y/N]';

/** `y`/`yes`, case-insensitive, means allow; anything else (including an empty line) means deny. */
function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

const NON_INTERACTIVE_REASON =
  'A grant cannot be given non-interactively; run markii in a terminal to allow network access.';

/**
 * One `HostAdapter.prompt` for every grant/consent question this app can
 * ever ask. Today that is only the three grant prompts `runViaAdapter`
 * builds through `@markii/host`'s `promptsFromAdapter` — this CLI has no
 * `packs` capability, so a pack-install/replace prompt kind never fires.
 * `onNonInteractiveDenial` fires at most once per adapter instance,
 * mirroring the old `prompts.ts`'s `warned` flag.
 */
function createCliPrompt(
  terminal: Terminal,
  onNonInteractiveDenial: (reason: string) => void,
): (request: HostPromptRequest) => Promise<boolean> {
  let warned = false;
  return async (request: HostPromptRequest): Promise<boolean> => {
    if (!terminal.stdinIsTty) {
      if (!warned) {
        warned = true;
        onNonInteractiveDenial(NON_INTERACTIVE_REASON);
      }
      return false;
    }
    const answer = await terminal.ask(`${request.message}${PROMPT_SUFFIX} `);
    return isAffirmative(answer);
  };
}

export interface CliHostAdapterOptions {
  readonly terminal: Terminal;
  readonly memento: GrantMemento;
  /** Called for anything worth telling the user about beyond a run/export outcome itself. Defaults to a no-op. */
  readonly diagnostics?: (line: string) => void;
  readonly now?: () => number;
  /**
   * Where an export should be written, when this adapter is built for an
   * export command. `resolveTarget` falls back to the suggested file name
   * when this is omitted, matching "the CLI returns the path it was
   * given" (`tmp/W11-adapter-design.md`, `HostExportCapabilities`).
   */
  readonly exportTarget?: string;
}

/**
 * Builds this CLI's `HostAdapter` from injected dependencies: no field
 * reads `process`, `env`, or argv on its own.
 */
export function createCliHostAdapter(
  options: CliHostAdapterOptions,
): HostAdapter {
  const diagnostics = options.diagnostics ?? ((): void => {});
  const exportFormats = new Set<HostExportFormat>(['html', 'ansi', 'md-plain']);

  return {
    id: 'cli',
    labels: CLI_LABELS,

    readFile: (path: string): Promise<Uint8Array> => readFile(path),
    exists: async (path: string): Promise<boolean> => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    writeFile: (path: string, bytes: Uint8Array): Promise<void> =>
      writeFile(path, bytes),
    listFolder: async (path: string): Promise<readonly HostDirEntry[]> => {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }));
      } catch {
        return [];
      }
    },

    prompt: createCliPrompt(options.terminal, diagnostics),

    memento: options.memento,

    diagnostics,

    now: options.now ?? ((): number => Date.now()),

    isolate: {
      kind: 'node',
      workerPath: (): string => resolveWorkerPath() ?? defaultWorkerPath(),
    },

    exports: {
      formats: exportFormats,
      resolveTarget: (suggestedFileName: string): Promise<string> =>
        Promise.resolve(options.exportTarget ?? suggestedFileName),
    },

    // No `editor`: no cursor, no live edit surface.
    // No `packs`: this CLI loads no packs by design (AGENTS.md).
  };
}
