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
 * - `editor`: declared only when the caller passes one, which `markii lsp`
 *   does. A one-shot terminal command has no cursor and no live edit
 *   surface to complete, hover, or insert into.
 * - `packs`: declared only when the caller passes `packs` (a pack root
 *   and the bundled-pack namespaces), engine `ansi`. A pack here runs
 *   INSIDE the CLI process with its full privileges, so the only folders
 *   ever authorized are the bundled packs next to the CLI and the
 *   device-local install store (one folder per namespace). Never a note, a
 *   bundle, the working directory, or an environment variable. A caller
 *   that does not pass `packs` (a run-only or export-only adapter) gets the
 *   honest `Unsupported` outcome from the pack behaviors.
 *
 * The prompt policy: with no TTY on stdin, `prompt` DENIES without asking,
 * since a grant cannot be given non-interactively. The one exception is
 * the pack install and replace consent when the caller passed `assumeYes`
 * (the explicit `--yes` flag): that answers yes to those two questions
 * only, never to a network grant. The denial reason reaches `diagnostics`
 * at most once per adapter instance, so a scripted invocation is not left
 * silently wondering why nothing was granted (AGENTS.md's "clean is not
 * silent").
 */
import { workerThreadIsolate } from '@markii/host/node';
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import {
  CLI_LABELS,
  type GrantMemento,
  type HostAdapter,
  type HostDirEntry,
  type HostEditor,
  type HostExportFormat,
  type HostPromptRequest,
} from '@markii/host';
import { defaultWorkerPath } from '@markii/host/node';
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

const NON_INTERACTIVE_PACK_REASON =
  'A pack install needs your consent; run markii in a terminal, or pass --yes to consent without being asked.';

/** Shown after the shared consent text: in a terminal a pack's code is not confined to a preview. */
const PACK_CONSENT_NOTE =
  ' In the terminal this code runs with all the permissions of your user account.';

function isPackConsent(request: HostPromptRequest): boolean {
  return (
    request.kind === 'pack-install-consent' || request.kind === 'pack-replace'
  );
}

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
  assumeYes: boolean,
): (request: HostPromptRequest) => Promise<boolean> {
  let warned = false;
  return async (request: HostPromptRequest): Promise<boolean> => {
    if (assumeYes && isPackConsent(request)) return true;
    if (!terminal.stdinIsTty) {
      if (!warned) {
        warned = true;
        onNonInteractiveDenial(
          isPackConsent(request)
            ? NON_INTERACTIVE_PACK_REASON
            : NON_INTERACTIVE_REASON,
        );
      }
      return false;
    }
    const message =
      request.kind === 'pack-install-consent'
        ? `${request.message}${PACK_CONSENT_NOTE}`
        : request.message;
    const answer = await terminal.ask(`${message}${PROMPT_SUFFIX} `);
    return isAffirmative(answer);
  };
}

/** Where this CLI's packs live. Passed by `main.ts`, never read from the environment here. */
export interface CliPackOptions {
  /** The device-local install store: one folder per namespace. */
  readonly installRoot: string;
  /** The packs shipped with the CLI (`dist/packs`, one folder each), when the build has any. */
  readonly bundledRoot?: string;
  /** Namespaces an install may never claim: the bundled packs' names. */
  readonly reservedNamespaces: ReadonlySet<string>;
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
  /** Declares the `packs` capability (engine `ansi`) when given. */
  readonly packs?: CliPackOptions;
  /**
   * Declares the `editor` capability, for `markii lsp` only: the language
   * server answers completion and hover for a client's open documents. A
   * command that has no live document leaves this out, and the editor
   * behaviors stay `Unsupported`.
   */
  readonly editor?: HostEditor;
  /** The explicit `--yes` flag: answers yes to the pack install and replace consent only. */
  readonly assumeYes?: boolean;
}

async function listSubfolders(folder: string): Promise<string[]> {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
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

    prompt: createCliPrompt(
      options.terminal,
      diagnostics,
      options.assumeYes === true,
    ),

    memento: options.memento,

    diagnostics,

    now: options.now ?? ((): number => Date.now()),

    isolate: {
      kind: 'node',
      workerPath: (): string => resolveWorkerPath() ?? defaultWorkerPath(),
      spawnIsolate: workerThreadIsolate,
    },

    exports: {
      formats: exportFormats,
      resolveTarget: (suggestedFileName: string): Promise<string> =>
        Promise.resolve(options.exportTarget ?? suggestedFileName),
    },

    // `editor` only for `markii lsp`; every other command has no cursor
    // and no live edit surface.
    ...(options.editor !== undefined ? { editor: options.editor } : {}),
    ...(options.packs !== undefined
      ? { packs: cliPackSource(options.packs, diagnostics) }
      : {}),
  };
}

function cliPackSource(
  packs: CliPackOptions,
  diagnostics: (line: string) => void,
): NonNullable<HostAdapter['packs']> {
  return {
    engine: 'ansi',
    // The CLI trusts its own device-local pack store (`markii pack install`
    // is the consent step); there is no separate trust list.
    trust: 'none',
    reservedNamespaces: () => packs.reservedNamespaces,
    installRoot: () => packs.installRoot,
    removeFolder: (folder: string): Promise<void> =>
      rm(folder, { recursive: true, force: true }),
    /**
     * The bundled packs first, then each installed one. Bundled namespaces
     * win: an installed folder carrying a reserved name (put there by hand,
     * since an install refuses it) is left out and reported.
     */
    authorizedFolders: async (): Promise<readonly string[]> => {
      const folders: string[] = [];
      if (packs.bundledRoot !== undefined) {
        for (const name of await listSubfolders(packs.bundledRoot)) {
          folders.push(path.join(packs.bundledRoot, name));
        }
      }
      for (const name of await listSubfolders(packs.installRoot)) {
        if (packs.reservedNamespaces.has(name)) {
          diagnostics(
            `Skipped installed pack folder "${name}": "${name}" is a built-in pack, and the built-in one is used.`,
          );
          continue;
        }
        folders.push(path.join(packs.installRoot, name));
      }
      return folders;
    },
  };
}
