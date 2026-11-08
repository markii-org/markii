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
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CLI_LABELS,
  createMarkiiHost,
  createRenderDiagnosticCollector,
  installPackMessage,
  noteHasScripts,
  readPersistedValues,
  removePackMessage,
  type GrantMemento,
} from '@markii/host';
import type { AnsiRegistry } from '@markii/ansi';
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
import { resolveCliPackOptions } from './pack-store.js';
import type { UnavailableComponent } from '@markii/stdlib';
import { loadCliPackRegistry } from './pack-registry.js';
import { runLiveViewer } from './live-view.js';
import { watchNote } from './watch-file.js';
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
  markii view <file> [--width <n>] [--color <auto|never|16|256|truecolor>]
              [--box <unicode|ascii>] [--no-run] [--static] [--watch]
  markii export <file> --format <html|ansi|md-plain> -o <file> [--box <unicode|ascii>]
  markii run <file>
  markii pack install <file.mkp> [--yes]
  markii pack list
  markii pack remove <namespace>

Global flags:
  --help, -h       Show this help text and exit.
  --version, -V    Show the CLI version and exit.
  --verbose        Print diagnostics to stderr.

view flags:
  --width <n>      Render at this column width. Defaults to the terminal
                    width, or 80 when that is not available.
  --color <mode>   auto (default), never, 16, 256, or truecolor.
  --box <style>    unicode or ascii. ascii draws frames, rules, and markers
                    with plain ASCII characters. Defaults to ascii when TERM
                    is dumb or the locale is not UTF-8, unicode otherwise.
  --no-run         Never run the note's scripts, even in an interactive
                    terminal; render with cached values only.
  --static         Render once and exit, even when both stdin and stdout
                    are terminals.
  --watch          Render again whenever the note changes on disk, until
                    q (live viewer) or Ctrl+C. Needs a terminal on stdout.
                    Scripts are not re-run on a change.

In a terminal, markii view opens the note in a live viewer. Left and right
(or tab) switch tabs, enter folds a details block open or closed, up and
down (or j and k) move focus between them, and q quits. Piping or
redirecting the output, or passing --static, renders the note once and
exits instead.

export flags:
  --format <fmt>   html, ansi, or md-plain. Required.
  -o, --output <file>   Where to write the exported file. Required.
  --box <style>    For --format ansi: unicode (default) or ascii.

Packs add components to a note. A pack that ships terminal views renders
them in markii view and markii export --format ansi; a pack without them
shows its components as "no terminal view" boxes. markii pack install asks
before it installs, because a pack's code runs with all the permissions of
your user account. In a session with no terminal, pass --yes to consent without being
asked. Packs are read only from the per-device install store and from the
packs shipped with this tool, never from a note or the current directory.

Grants for a note's scripts are stored per device; see README.md for the
exact location on each platform. A grant cannot be given non-interactively.

Exit codes: 0 ok, 1 a render or read failure, 2 a script failure, 3 a
usage error.
`;

function buildGrantMemento(terminal: Terminal) {
  const dir = grantStoreDirectory(terminal.env, process.platform);
  return createFileGrantMemento(path.join(dir, CLI_STATE_FILE_NAME));
}

/**
 * Loads the bundled and installed packs for a render (`view`, or `export
 * --format ansi`), through the shared host. A pack that cannot be used leaves
 * its directives as the unknown-component fallback; the reason is a line on
 * stderr. Failures always reach stderr (`emit`); the informational lines
 * (which packs loaded) only under `--verbose`.
 */
async function loadPackRegistry(
  terminal: Terminal,
  memento: GrantMemento,
  verbose: boolean,
  emit: (line: string) => void,
): Promise<{
  readonly registry: AnsiRegistry;
  readonly unavailable: readonly UnavailableComponent[];
}> {
  const adapter = createCliHostAdapter({
    terminal,
    memento,
    packs: resolveCliPackOptions(terminal.env, process.platform),
    diagnostics: (line) => {
      if (verbose) emit(`markii: ${line}\n`);
    },
  });
  const loaded = await loadCliPackRegistry(createMarkiiHost(adapter));
  if (!verbose) {
    for (const line of loaded.failureLines) emit(`markii: ${line}\n`);
  }
  return { registry: loaded.registry, unavailable: loaded.unavailable };
}

/**
 * Every installed pack component, for the static HTML export. That engine
 * draws no pack views, so each of these reads "no HTML view" in the file
 * instead of "unknown component". Loads nothing else: no pack code is read.
 */
async function loadInstalledComponents(
  terminal: Terminal,
  verbose: boolean,
): Promise<readonly UnavailableComponent[]> {
  const adapter = createCliHostAdapter({
    terminal,
    memento: NOOP_MEMENTO,
    packs: resolveCliPackOptions(terminal.env, process.platform),
    diagnostics: (line) => {
      if (verbose) terminal.writeError(`markii: ${line}\n`);
    },
  });
  const outcome = await createMarkiiHost(adapter).loadPacks();
  return outcome.kind === 'loaded' ? outcome.components : [];
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
    let text = input.text;
    const buildElement = (
      width: number,
      onExit: () => void,
      rows: number | undefined,
    ) =>
      buildViewElement(text, input.terminal, width, {
        ...(input.colorFlag !== undefined
          ? { colorFlag: input.colorFlag }
          : {}),
        ...(input.boxFlag !== undefined ? { boxFlag: input.boxFlag } : {}),
        store: input.store,
        ...(input.registry !== undefined ? { registry: input.registry } : {}),
        ...(input.unavailableComponents !== undefined
          ? { unavailableComponents: input.unavailableComponents }
          : {}),
        onDiagnostic: input.onDiagnostic,
        onExit,
        ...(rows !== undefined ? { rows } : {}),
      });
    const onTextChange = input.onTextChange;
    await runLiveViewer({
      stdout: process.stdout,
      stdin: process.stdin,
      initialWidth,
      buildElement,
      ...(onTextChange
        ? {
            subscribe: (refresh: () => void) =>
              onTextChange((next) => {
                text = next;
                refresh();
              }),
          }
        : {}),
    });
  },
  watchNote: (absolutePath, onChange) => watchNote(absolutePath, onChange),
  untilInterrupted: () =>
    new Promise<void>((resolve) => {
      process.once('SIGINT', () => resolve());
    }),
};

/** Clears the screen and homes the cursor before a static `--watch` redraw. */
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

async function runViewCommand(
  command: Extract<ParsedCommand, { kind: 'view' }>,
  terminal: Terminal,
  deps: ViewDeps = defaultViewDeps,
): Promise<number> {
  // A static redraw clears the screen, which only makes sense on a
  // terminal; into a pipe or a file it would be a stream of escapes.
  if (command.watch && !terminal.stdoutIsTty) {
    terminal.writeError(
      'markii: --watch needs a terminal on stdout, since it redraws the screen on every change\n',
    );
    return 3;
  }

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
    // The detail lines (each failure's message, net-declaration mismatches)
    // come from the shared run path through onDiagnosticLine, so --verbose
    // shows them once; only this one-line summary is written here.
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
  const { registry, unavailable } = await loadPackRegistry(
    terminal,
    memento,
    command.verbose,
    writeError,
  );

  // `--watch`: every change re-reads the note and hands the new text to
  // `onText`. A note that cannot be read mid-watch (deleted, or caught
  // half-written) keeps the last good render on screen and says why once
  // per failure on stderr; in the live viewer that line is held like
  // every other one until the viewer closes.
  const startWatch = (onText: (text: string) => void): (() => void) => {
    const watchFn = deps.watchNote;
    if (!watchFn) return () => {};
    let lastError: string | undefined;
    const watch = watchFn(absolutePath, () => {
      void readNote(absolutePath).then((next) => {
        if (!next.ok) {
          if (next.message !== lastError) {
            lastError = next.message;
            writeError(`markii: ${next.message}\n`);
          }
          return;
        }
        lastError = undefined;
        onText(next.note.text);
      });
    });
    return () => watch.close();
  };

  if (mode === 'static') {
    const renderText = (text: string): Promise<string> =>
      renderNote(text, terminal, {
        ...(command.width !== undefined ? { widthFlag: command.width } : {}),
        ...(command.color !== undefined ? { colorFlag: command.color } : {}),
        ...(command.box !== undefined ? { boxFlag: command.box } : {}),
        store,
        registry,
        unavailableComponents: unavailable,
        onDiagnostic: diagnostics.onDiagnostic,
      });
    if (command.watch) {
      terminal.write(`${CLEAR_SCREEN}${await renderText(note.text)}`);
      // The collector dedupes for the whole watch, so a reason reaches
      // stderr once, the first time a render produces it.
      let reported = 0;
      const flushDiagnostics = (): void => {
        const lines = diagnostics.lines();
        for (const line of lines.slice(reported)) {
          terminal.writeError(`markii: ${line}\n`);
        }
        reported = lines.length;
      };
      flushDiagnostics();
      // Renders are chained so two quick changes can never draw out of
      // order.
      let rendering = Promise.resolve();
      const stop = startWatch((text) => {
        rendering = rendering.then(async () => {
          terminal.write(`${CLEAR_SCREEN}${await renderText(text)}`);
          flushDiagnostics();
        });
      });
      await (deps.untilInterrupted?.() ?? Promise.resolve());
      stop();
      await rendering;
      return exitCode;
    }
    const output = await renderText(note.text);
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
    ...(command.box !== undefined ? { boxFlag: command.box } : {}),
    store,
    registry,
    unavailableComponents: unavailable,
    onDiagnostic: diagnostics.onDiagnostic,
    ...(command.watch
      ? {
          onTextChange: (listener: (text: string) => void) =>
            startWatch(listener),
        }
      : {}),
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

  // The render-diagnostics collector fills for 'ansi' (rendered through this
  // CLI's own `renderNote`) and for 'html' (the static engine, through the
  // export request); it stays empty for 'md-plain'.
  const renderDiagnostics = createRenderDiagnosticCollector();
  // Only an ansi export renders through the terminal engine, so only it loads
  // packs. An html export keeps rendering a pack directive as the fallback.
  const loadedPacks =
    command.format === 'ansi'
      ? await loadPackRegistry(terminal, memento, command.verbose, (line) =>
          terminal.writeError(line),
        )
      : undefined;
  const registry = loadedPacks?.registry;
  // The static HTML engine draws no pack views either: each installed
  // component reads "no HTML view" in the file, and the reason goes to stderr.
  const htmlUnavailable =
    command.format === 'html'
      ? await loadInstalledComponents(terminal, command.verbose)
      : undefined;
  const renderAnsi = (text: string): Promise<string> =>
    renderNote(text, terminal, {
      ...(registry !== undefined ? { registry } : {}),
      ...(loadedPacks !== undefined
        ? { unavailableComponents: loadedPacks.unavailable }
        : {}),
      colorFlag: command.color ?? 'never',
      // An exported file is read in some other terminal, so like its color
      // it does not follow this one's environment: unicode unless asked.
      boxFlag: command.box ?? 'unicode',
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
    ...(htmlUnavailable !== undefined
      ? {
          unavailableComponents: htmlUnavailable,
          onDiagnostic: renderDiagnostics.onDiagnostic,
        }
      : {}),
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

  // The shared run path already wrote every failure and net-declaration
  // line through onDiagnosticLine; writing them here again would repeat them.

  return result.failures.length > 0 ? 2 : 0;
}

/** An adapter for the three `markii pack` commands: pack capability on, run-grant state untouched. */
function packCommandHost(
  terminal: Terminal,
  options: { assumeYes: boolean; verbose: boolean },
): { host: ReturnType<typeof createMarkiiHost>; lines: string[] } {
  const lines: string[] = [];
  const adapter = createCliHostAdapter({
    terminal,
    memento: NOOP_MEMENTO,
    packs: resolveCliPackOptions(terminal.env, process.platform),
    assumeYes: options.assumeYes,
    diagnostics: (line) => lines.push(line),
  });
  return { host: createMarkiiHost(adapter), lines };
}

/** The diagnostics lines of a command whose outcome is the whole point: always on failure, only under `--verbose` on success. */
function flushPackDiagnostics(
  terminal: Terminal,
  lines: readonly string[],
  show: boolean,
): void {
  if (!show) return;
  for (const line of lines) terminal.writeError(`markii: ${line}\n`);
}

async function runPackInstallCommand(
  command: Extract<ParsedCommand, { kind: 'pack-install' }>,
  terminal: Terminal,
): Promise<number> {
  const archivePath = path.resolve(command.file);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(archivePath));
  } catch (error) {
    terminal.writeError(
      `markii: could not read ${command.file}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
  const { host, lines } = packCommandHost(terminal, {
    assumeYes: command.yes,
    verbose: command.verbose,
  });
  const outcome = await host.installPack({
    archiveBytes: bytes,
    archivePath: command.file,
  });

  if (outcome.kind === 'installed') {
    terminal.write(
      `${installPackMessage(
        {
          kind: 'installed',
          packName: outcome.namespace,
          installedDir: '',
          replaced: outcome.replaced,
        },
        command.file,
        CLI_LABELS,
      )}\n`,
    );
    // A pack with no terminal views installs fine and labels its components
    // "no terminal view" here; say so now rather than at first use.
    const loaded = await host.loadTerminalPacks();
    if (
      loaded.kind === 'loaded' &&
      !loaded.namespaces.includes(outcome.namespace)
    ) {
      terminal.write(
        `Markii: "${outcome.namespace}" has no terminal views. Its components show as "no terminal view" here.\n`,
      );
    }
    flushPackDiagnostics(terminal, lines, command.verbose);
    return 0;
  }

  if (outcome.kind === 'declined') {
    terminal.writeError(
      `${installPackMessage(
        {
          kind: 'declined',
          step: outcome.step,
          packName: outcome.namespace,
        },
        command.file,
        CLI_LABELS,
      )}\n`,
    );
  } else if (outcome.kind === 'reserved') {
    terminal.writeError(
      `${installPackMessage({ kind: 'reserved', packName: outcome.namespace }, command.file, CLI_LABELS)}\n`,
    );
  } else if (outcome.kind === 'rejected') {
    terminal.writeError(
      `${installPackMessage({ kind: 'rejected', reason: outcome.reason }, command.file, CLI_LABELS)}\n`,
    );
  } else {
    terminal.writeError('Markii: this tool cannot install packs here.\n');
  }
  flushPackDiagnostics(terminal, lines, true);
  return 1;
}

async function runPackListCommand(
  command: Extract<ParsedCommand, { kind: 'pack-list' }>,
  terminal: Terminal,
): Promise<number> {
  const { host, lines } = packCommandHost(terminal, {
    assumeYes: false,
    verbose: command.verbose,
  });
  const outcome = await host.loadTerminalPacks();
  if (outcome.kind !== 'loaded') {
    flushPackDiagnostics(terminal, lines, true);
    return 1;
  }
  const bundledRoot = resolveCliPackOptions(
    terminal.env,
    process.platform,
  ).bundledRoot;
  const rows: string[] = [];
  for (const pack of outcome.packs) {
    const total = Object.keys(
      pack.componentPathsByEngine?.['ansi'] ?? {},
    ).length;
    const version =
      pack.manifest.version !== undefined ? ` ${pack.manifest.version}` : '';
    const origin =
      bundledRoot !== undefined && pack.folder.startsWith(bundledRoot)
        ? 'built in'
        : 'installed';
    rows.push(
      `${pack.manifest.name}${version}: ${String(total)} terminal component${total === 1 ? '' : 's'} (${origin})`,
    );
  }
  for (const skipped of outcome.skipped) {
    if (skipped.engineUnsupported !== undefined) {
      rows.push(
        `${skipped.engineUnsupported.packName}: no terminal views (installed)`,
      );
    }
  }
  terminal.write(
    rows.length > 0 ? `${rows.join('\n')}\n` : 'No packs are installed.\n',
  );
  // Anything that stopped a pack from loading is the reason it is missing
  // from the list above, so it always reaches stderr.
  for (const line of outcome.failureLines)
    terminal.writeError(`markii: ${line}\n`);
  flushPackDiagnostics(
    terminal,
    lines.filter((line) => !outcome.failureLines.includes(line)),
    command.verbose,
  );
  return 0;
}

async function runPackRemoveCommand(
  command: Extract<ParsedCommand, { kind: 'pack-remove' }>,
  terminal: Terminal,
): Promise<number> {
  const { host, lines } = packCommandHost(terminal, {
    assumeYes: false,
    verbose: command.verbose,
  });
  const outcome = await host.removePack(command.namespace);
  if (outcome.kind === 'unsupported') {
    terminal.writeError('Markii: this tool cannot remove packs here.\n');
    flushPackDiagnostics(terminal, lines, true);
    return 1;
  }
  if (outcome.kind === 'removed') {
    terminal.write(`${removePackMessage(outcome)}\n`);
    flushPackDiagnostics(terminal, lines, command.verbose);
    return 0;
  }
  terminal.writeError(`${removePackMessage(outcome)}\n`);
  flushPackDiagnostics(terminal, lines, true);
  return 1;
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
    case 'pack-install':
      return runPackInstallCommand(command, terminal);
    case 'pack-list':
      return runPackListCommand(command, terminal);
    case 'pack-remove':
      return runPackRemoveCommand(command, terminal);
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
