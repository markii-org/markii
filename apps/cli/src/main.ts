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
import { readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createRenderDiagnosticCollector,
  noteHasScripts,
  readPersistedValues,
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
import { renderNote } from './render-note.js';
import { runNote } from './run-note.js';
import { exportHtml, mdPlainFromSource } from './export-note.js';

function versionFallback(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
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
  markii view <file> [--width <n>] [--color <auto|never|16|256|truecolor>] [--no-run]
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

async function runViewCommand(
  command: Extract<ParsedCommand, { kind: 'view' }>,
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
  const documentKey = pathToFileURL(absolutePath).toString();

  const hasScripts = noteHasScripts(note.text);
  const shouldRun =
    command.run && hasScripts && terminal.stdinIsTty && terminal.stdoutIsTty;

  let values: Record<string, StoredValue>;
  let exitCode = 0;

  if (shouldRun) {
    const result = await runNote({
      absolutePath,
      note,
      terminal,
      memento,
      onDiagnosticLine: (line) => {
        if (command.verbose) terminal.writeError(`markii: ${line}\n`);
      },
    });
    values = result.values;
    writeFailureLines(terminal, result.failures);
    if (command.verbose) {
      writeFailureDetails(
        terminal,
        result.failureDetails,
        result.netDeclarationDiagnostics,
      );
    }
    if (result.failures.length > 0) exitCode = 2;
  } else {
    values = readPersistedValues(memento, documentKey);
    if (command.verbose && command.run && hasScripts) {
      terminal.writeError(
        'markii: not running scripts (requires an interactive terminal); showing cached values.\n',
      );
    }
  }

  const store = createValueStore(values);
  const diagnostics = createRenderDiagnosticCollector();
  const output = renderNote(note.text, terminal, {
    ...(command.width !== undefined ? { widthFlag: command.width } : {}),
    ...(command.color !== undefined ? { colorFlag: command.color } : {}),
    store,
    onDiagnostic: diagnostics.onDiagnostic,
  });
  terminal.write(output);
  if (command.verbose) {
    for (const line of diagnostics.lines()) {
      terminal.writeError(`markii: ${line}\n`);
    }
  }

  return exitCode;
}

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

  if (command.format === 'md-plain') {
    const out = mdPlainFromSource(note.text);
    writeFileSync(command.out, out, 'utf-8');
    return 0;
  }

  const memento = buildGrantMemento(terminal);
  const documentKey = pathToFileURL(absolutePath).toString();
  const values = readPersistedValues(memento, documentKey);

  if (command.format === 'html') {
    const html = exportHtml(note.text, path.basename(command.file), values);
    writeFileSync(command.out, html, 'utf-8');
    return 0;
  }

  // 'ansi': color defaults to 'never' for a file (nobody's terminal reads
  // it directly), honouring an explicit --color when given.
  const store = createValueStore(values);
  const diagnostics = createRenderDiagnosticCollector();
  const output = renderNote(note.text, terminal, {
    colorFlag: command.color ?? 'never',
    store,
    onDiagnostic: diagnostics.onDiagnostic,
  });
  writeFileSync(command.out, output, 'utf-8');
  for (const line of diagnostics.lines()) {
    terminal.writeError(`markii: ${line}\n`);
  }
  return 0;
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

export async function run(
  argv: readonly string[],
  terminal: Terminal,
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
      return runViewCommand(command, terminal);
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
