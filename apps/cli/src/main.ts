/**
 * The `markii` CLI entry point. Together with `terminal.ts`, this is the
 * ONLY module in this app that reads the environment, the terminal, or the
 * argument vector, or writes directly to stdout/stderr. Every other module
 * takes what it needs as plain arguments, which is what keeps the rest of
 * this app testable with a fake terminal and no real filesystem. (The one
 * other `process` reference in this app is `grant-store.ts` naming its
 * temporary file after the process id, which is uniqueness, not input.) `main.ts` itself owns
 * `process.exitCode` and never lets anything throw out of the process.
 *
 * Exit codes: 0 ok, 1 a render/parse failure or an unreadable file, 2 a
 * script failure, 3 a usage error.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createMarkiiHost,
  createRenderDiagnosticCollector,
  noteHasScripts,
  readPersistedValues,
  type GrantMemento,
} from '@markii/host';
import { createValueStore, type StoredValue } from '@markii/runtime';
import { parseArgs, type ParsedCommand } from './args.js';
import { createNodeTerminal, type Terminal } from './terminal.js';
import { readNote } from './read-note.js';
import {
  grantStoreDirectory,
  createFileGrantMemento,
  CLI_STATE_FILE_NAME,
} from './grant-store.js';
import { buildViewElement, renderNote, resolveWidth } from './render-note.js';
import { runNote } from './run-note.js';
import { createCliHostAdapter } from './host-adapter.js';
import { resolveViewMode } from './view-mode.js';
import { runLiveViewer } from './live-view.js';
import type { MountLiveViewerInput, ViewDeps } from './view-deps.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function versionFallback(): string {
  try {
    const pkgPath = path.join(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * The CLI's own version. In the built bundle, esbuild's `define` replaces
 * `process.env.MARKII_CLI_VERSION` with the literal version string from
 * `package.json` at build time; unbundled (dev/Vitest), that environment
 * variable is unset, so this reads `package.json` directly instead.
 */
function resolveCliVersion(): string {
  const defined = process.env.MARKII_CLI_VERSION;
  return defined !== undefined && defined !== '' ? defined : versionFallback();
}

const HELP_TEXT = `markii: a terminal front end for Markii (.mk.md) notes.

Usage:
  markii view <file> [--width <n>] [--color <auto|never|16|256|truecolor>] [--no-run] [--static]
  markii export <file> --format <html|ansi|md-plain> -o <file>
  markii run <file>

Global flags:
  --help, -h       Show this help text and exit.
  --version, -V    Show the CLI version and exit.
  --verbose        Print diagnostics to stderr.

view flags:
  --width <n>      Render at this column width. Defaults to the terminal
                    width, or 80 when that is not available.
  --color <mode>   auto (default), never, 16, 256, or truecolor.
  --no-run         Never run the note's scripts, even in an interactive
                    terminal; render with cached values only.
  --static         Render once and exit, even when both stdin and stdout
                    are terminals.

In a terminal, markii view opens the note in a live viewer. Left and right
(or tab) switch tabs, enter folds a details block open or closed, up and
down (or j and k) move focus between them, and q quits. Piping or
redirecting the output, or passing --static, renders the note once and
exits instead.

export flags:
  --format <fmt>   html, ansi, or md-plain. Required.
  -o, --output <file>   Where to write the exported file. Required.

Grants for a note's scripts are stored per device; see README.md for the
exact location on each platform. A grant cannot be given non-interactively.

Exit codes: 0 ok, 1 a render or read failure, 2 a script failure, 3 a
usage error.
`;

function buildGrantMemento(terminal: Terminal) {
  const dir = grantStoreDirectory(terminal.env, process.platform);
  return createFileGrantMemento(path.join(dir, CLI_STATE_FILE_NAME));
}

function writeFailureLines(
  terminal: Terminal,
  failures: readonly { name: string; kind: string }[],
): void {
  for (const failure of failures) {
    terminal.writeError(
      `markii: script "${failure.name}" failed (${failure.kind})\n`,
    );
  }
}

function writeFailureDetails(
  terminal: Terminal,
  details: readonly { name: string; message: string }[],
  netDiagnostics: readonly string[],
): void {
  for (const detail of details) {
    terminal.writeError(`markii: ${detail.name}: ${detail.message}\n`);
  }
  for (const line of netDiagnostics) {
    terminal.writeError(`markii: ${line}\n`);
  }
}

/**
 * The real live-viewer mount, wired to the actual process streams. Defined
 * here (not in `view-deps.ts` or `live-view.ts`) because `main.ts` is the
 * only module allowed to read `process.stdout`/`process.stdin` directly;
 * everything it calls into takes those streams as plain arguments.
 */
const defaultViewDeps: ViewDeps = {
  mountLiveViewer: async (input: MountLiveViewerInput): Promise<void> => {
    const initialWidth = resolveWidth(input.widthFlag, input.terminal);
    const buildElement = (width: number, onExit: () => void) =>
      buildViewElement(input.text, input.terminal, width, {
        ...(input.colorFlag !== undefined
          ? { colorFlag: input.colorFlag }
          : {}),
        store: input.store,
        onDiagnostic: input.onDiagnostic,
        onExit,
      });
    await runLiveViewer({
      stdout: process.stdout,
      stdin: process.stdin,
      initialWidth,
      buildElement,
    });
  },
};

async function runViewCommand(
  command: Extract<ParsedCommand, { kind: 'view' }>,
  terminal: Terminal,
  deps: ViewDeps = defaultViewDeps,
): Promise<number> {
  const absolutePath = path.resolve(command.file);
  const read = await readNote(absolutePath);
  if (!read.ok) {
    terminal.writeError(`markii: ${read.message}\n`);
    return 1;
  }
  const note = read.note;
  const memento = buildGrantMemento(terminal);
  const documentKey = pathToFileURL(absolutePath).toString();

  const hasScripts = noteHasScripts(note.text);
  const shouldRun =
    command.run && hasScripts && terminal.stdinIsTty && terminal.stdoutIsTty;

  const mode = resolveViewMode({
    stdinIsTty: terminal.stdinIsTty,
    stdoutIsTty: terminal.stdoutIsTty,
    staticFlag: command.static,
  });

  // Diagnostics must not corrupt the live display: while the live viewer
  // owns the terminal, every stderr line goes here instead of straight to
  // `terminal.writeError`, and is flushed only after the viewer unmounts.
  // AGENTS.md's "clean is not silent" rule still applies: nothing here is
  // ever dropped, only deferred. In static mode this writes immediately,
  // exactly as it always has, so the piped/redirected path is unaffected.
  const heldErrorLines: string[] = [];
  const writeError = (line: string): void => {
    if (mode === 'live') heldErrorLines.push(line);
    else terminal.writeError(line);
  };

  let values: Record<string, StoredValue>;
  let exitCode = 0;

  if (shouldRun) {
    const result = await runNote({
      absolutePath,
      note,
      terminal,
      memento,
      onDiagnosticLine: (line) => {
        if (command.verbose) writeError(`markii: ${line}\n`);
      },
    });
    values = result.values;
    for (const failure of result.failures) {
      writeError(`markii: script "${failure.name}" failed (${failure.kind})\n`);
    }
    if (command.verbose) {
      for (const detail of result.failureDetails) {
        writeError(`markii: ${detail.name}: ${detail.message}\n`);
      }
      for (const line of result.netDeclarationDiagnostics) {
        writeError(`markii: ${line}\n`);
      }
    }
    if (result.failures.length > 0) exitCode = 2;
  } else {
    values = readPersistedValues(memento, documentKey);
    // AGENTS.md's "clean is not silent" rule: a note with scripts that are
    // skipped because stdin/stdout is not a terminal is a real, discoverable
    // outcome, not just a --verbose detail, so this reaches stderr always.
    // (This branch only runs when at least one stream is not a TTY, so
    // `mode` is always 'static' here and this reaches stderr immediately.)
    if (command.run && hasScripts) {
      writeError(
        'markii: scripts not run because the output is not a terminal; use markii run first\n',
      );
    }
  }

  const store = createValueStore(values);
  const diagnostics = createRenderDiagnosticCollector();

  if (mode === 'static') {
    const output = await renderNote(note.text, terminal, {
      ...(command.width !== undefined ? { widthFlag: command.width } : {}),
      ...(command.color !== undefined ? { colorFlag: command.color } : {}),
      store,
      onDiagnostic: diagnostics.onDiagnostic,
    });
    terminal.write(output);
    // Render diagnostics (a declined attribute value, a refused image
    // source) are the reason behind an in-note marker that has no tooltip
    // in a terminal; AGENTS.md's "clean is not silent" rule means they
    // always reach stderr, not just under --verbose. --verbose only adds
    // the pack/run diagnostics printed above.
    for (const line of diagnostics.lines()) {
      terminal.writeError(`markii: ${line}\n`);
    }
    return exitCode;
  }

  // mode === 'live': mount the interactive viewer, holding every diagnostic
  // until it unmounts (q, or the underlying Ink instance otherwise exits).
  await deps.mountLiveViewer({
    text: note.text,
    terminal,
    ...(command.width !== undefined ? { widthFlag: command.width } : {}),
    ...(command.color !== undefined ? { colorFlag: command.color } : {}),
    store,
    onDiagnostic: diagnostics.onDiagnostic,
  });
  for (const line of diagnostics.lines()) {
    heldErrorLines.push(`markii: ${line}\n`);
  }
  for (const line of heldErrorLines) {
    terminal.writeError(line);
  }

  return exitCode;
}

/**
 * A `GrantMemento` that never touches disk: used for a `md-plain` export,
 * which needs no persisted grants or values, so it never reads the
 * device's state file at all — matching this command's behavior before
 * `@markii/host`'s shared export path took over the write.
 */
const NOOP_MEMENTO: GrantMemento = {
  get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
  update: (): Promise<void> => Promise.resolve(),
};

async function runExportCommand(
  command: Extract<ParsedCommand, { kind: 'export' }>,
  terminal: Terminal,
): Promise<number> {
  const absolutePath = path.resolve(command.file);
  const read = await readNote(absolutePath);
  if (!read.ok) {
    terminal.writeError(`markii: ${read.message}\n`);
    return 1;
  }
  const note = read.note;

  let values: Record<string, StoredValue> | undefined;
  let memento: GrantMemento = NOOP_MEMENTO;
  if (command.format !== 'md-plain') {
    memento = buildGrantMemento(terminal);
    const documentKey = pathToFileURL(absolutePath).toString();
    values = readPersistedValues(memento, documentKey);
  }

  // The render-diagnostics collector only ever fills for 'ansi' (the one
  // format rendered through this CLI's own `renderNote`); it stays empty,
  // and this loop a no-op, for 'html' and 'md-plain'.
  const renderDiagnostics = createRenderDiagnosticCollector();
  const renderAnsi = (text: string): Promise<string> =>
    renderNote(text, terminal, {
      colorFlag: command.color ?? 'never',
      store: createValueStore(values ?? {}),
      onDiagnostic: renderDiagnostics.onDiagnostic,
    });

  const adapter = createCliHostAdapter({
    terminal,
    memento,
    exportTarget: command.out,
    diagnostics: (line) => {
      if (command.verbose) terminal.writeError(`markii: ${line}\n`);
    },
  });
  const host = createMarkiiHost(adapter, { renderAnsi });

  const outcome = await host.exportNote({
    format: command.format,
    notePath: absolutePath,
    text: note.text,
    ...(values !== undefined ? { values } : {}),
  });

  for (const line of renderDiagnostics.lines()) {
    terminal.writeError(`markii: ${line}\n`);
  }

  if (outcome.kind === 'exported') return 0;
  if (outcome.kind === 'failed') {
    terminal.writeError(
      `markii: could not export this note: ${outcome.reason}\n`,
    );
    return 1;
  }
  // 'cancelled' or 'unsupported': neither is reachable through this app's
  // own supported formats today, but the outcome type covers them, so
  // this command reports rather than assumes they can't happen.
  terminal.writeError('markii: export did not produce a file.\n');
  return 1;
}

async function runRunCommand(
  command: Extract<ParsedCommand, { kind: 'run' }>,
  terminal: Terminal,
): Promise<number> {
  const absolutePath = path.resolve(command.file);
  const read = await readNote(absolutePath);
  if (!read.ok) {
    terminal.writeError(`markii: ${read.message}\n`);
    return 1;
  }
  const note = read.note;
  const memento = buildGrantMemento(terminal);

  const result = await runNote({
    absolutePath,
    note,
    terminal,
    memento,
    onDiagnosticLine: (line) => terminal.writeError(`markii: ${line}\n`),
  });

  writeFailureLines(terminal, result.failures);
  writeFailureDetails(
    terminal,
    result.failureDetails,
    result.netDeclarationDiagnostics,
  );

  return result.failures.length > 0 ? 2 : 0;
}

/**
 * `deps` is an internal seam, not part of the CLI's real usage: it lets
 * tests replace `markii view`'s live-viewer mount with a fake so a test run
 * never spawns a real Ink instance or touches a real TTY (see `view-deps.ts`
 * and `main.test.ts`'s "view: live viewer" tests). `main()` below always
 * calls this with the default, real implementation.
 */
export async function run(
  argv: readonly string[],
  terminal: Terminal,
  deps: { readonly view?: ViewDeps } = {},
): Promise<number> {
  const command = parseArgs(argv);

  switch (command.kind) {
    case 'help':
      terminal.write(HELP_TEXT);
      return 0;
    case 'version':
      terminal.write(`${resolveCliVersion()}\n`);
      return 0;
    case 'usage-error':
      terminal.writeError(`markii: ${command.message}\n`);
      return 3;
    case 'view':
      return runViewCommand(command, terminal, deps.view ?? defaultViewDeps);
    case 'export':
      return runExportCommand(command, terminal);
    case 'run':
      return runRunCommand(command, terminal);
  }
}

async function main(): Promise<void> {
  const terminal = createNodeTerminal();
  try {
    process.exitCode = await run(process.argv.slice(2), terminal);
  } catch (error) {
    terminal.writeError(
      `markii: internal error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

void main();
