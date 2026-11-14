/**
 * `markii lsp`: the language server over the terminal's stdio. This module
 * wires the pieces (the shared host for completion and hover, the pack
 * catalog for diagnostics, the protocol server) and resolves with the
 * process exit code once the client sends `exit` or closes the stream.
 * The protocol itself lives in `./lsp/server.ts`; the Markii behavior
 * lives in `@markii/host` and `@markii/stdlib/editor`.
 *
 * Packs are discovered the way `markii view` discovers them (the
 * device-local store and the packs shipped with this tool), lazily on the
 * first check, and only their `pack.json` is read.
 */
import {
  createMarkiiHost,
  type GrantMemento,
  type HostEditor,
} from '@markii/host';
import { formatPackDiagnosticLines } from '@markii/host/internal';
import {
  standardNoteCatalog,
  type DiagnosticEvent,
  type NoteCatalogEntry,
} from '@markii/stdlib';
import { createCliHostAdapter } from './host-adapter.js';
import { resolveCliPackOptions } from './pack-store.js';
import { noteDiagnostics, packNoteCatalog } from './lsp/note-diagnostics.js';
import { createLspServer, type LspServer } from './lsp/server.js';
import type { Terminal } from './terminal.js';

/** The language server never runs scripts, so it has no grants to read or write. */
const NO_GRANTS: GrantMemento = {
  get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
  update: (): Promise<void> => Promise.resolve(),
};

/**
 * Completion and hover receive the document text in each request, so the
 * host's editor surface has nothing to read or write of its own. Every
 * edit a completion needs travels back to the client in the response.
 */
const REQUEST_SCOPED_EDITOR: HostEditor = {
  documentText: () => '',
  documentPath: () => undefined,
  cursor: () => ({ line: 0, column: 0 }),
  applyEdits: () => Promise.resolve(false),
};

export async function runLspCommand(
  terminal: Terminal,
  options: {
    readonly serverVersion: string;
    readonly platform: string;
    readonly verbose: boolean;
  },
): Promise<number> {
  const stdio = terminal.openStdio();
  const adapter = createCliHostAdapter({
    terminal,
    memento: NO_GRANTS,
    packs: resolveCliPackOptions(terminal.env, options.platform),
    editor: REQUEST_SCOPED_EDITOR,
    // Informational pack lines only under --verbose, like `markii view`;
    // the failures that matter are reported through the server below.
    diagnostics: (line) => {
      if (options.verbose) terminal.writeError(`markii: ${line}\n`);
    },
  });
  const host = createMarkiiHost(adapter);

  // Pack components are read from each pack.json, lazily on the first
  // check. No pack script is read or evaluated here: a finding about a note
  // must never run code a pack ships.
  let catalog: Promise<readonly NoteCatalogEntry[]> | undefined;
  const loadCatalog = (): Promise<readonly NoteCatalogEntry[]> => {
    catalog ??= host.loadPacks().then((outcome) => {
      if (outcome.kind !== 'loaded') return standardNoteCatalog();
      // A folder that could not be read as a pack leaves its directives
      // unknown in the findings; the reason goes to the client's log.
      const failing = outcome.skipped.filter(
        (entry) => entry.engineUnsupported === undefined,
      );
      for (const line of formatPackDiagnosticLines({
        packs: [],
        skipped: failing,
        engine: undefined,
        cssWarnings: [],
      })) {
        server?.notice(line);
      }
      return packNoteCatalog(outcome);
    });
    return catalog;
  };

  let server: LspServer | undefined;
  return new Promise<number>((resolve) => {
    server = createLspServer({
      serverVersion: options.serverVersion,
      write: (frame) => stdio.write(frame),
      log: (line) => terminal.writeError(`markii: ${line}\n`),
      exit: (code) => {
        void server?.idle().then(() => {
          stdio.release();
          resolve(code);
        });
      },
      completeAt: (request) => host.completeAt(request),
      hoverAt: (request) => host.hoverAt(request),
      diagnose: async (text): Promise<DiagnosticEvent[]> => {
        return noteDiagnostics(text, await loadCatalog());
      },
    });
    const running = server;
    stdio.onData((chunk) => running.receive(chunk));
    stdio.onEnd(() => running.streamEnded());
  });
}
