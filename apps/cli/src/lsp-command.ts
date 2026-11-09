/**
 * `markii lsp`: the language server over the terminal's stdio. This module
 * wires the pieces (the shared host for completion and hover, the pack
 * registry for diagnostics, the protocol server) and resolves with the
 * process exit code once the client sends `exit` or closes the stream.
 * The protocol itself lives in `./lsp/server.ts`; the Markii behavior
 * lives in `@markii/host` and `@markii/stdlib/editor`.
 *
 * Packs load the way `markii view` loads them (the device-local store and
 * the packs shipped with this tool), lazily on the first check, so a
 * client that only completes never pays for it.
 */
import {
  createMarkiiHost,
  type GrantMemento,
  type HostEditor,
} from '@markii/host';
import type { DiagnosticEvent } from '@markii/stdlib';
import { createCliHostAdapter } from './host-adapter.js';
import { loadCliPackRegistry, type CliPackRegistry } from './pack-registry.js';
import { resolveCliPackOptions } from './pack-store.js';
import { noteDiagnostics } from './lsp/note-diagnostics.js';
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

  let packs: Promise<CliPackRegistry> | undefined;
  const loadPacks = (): Promise<CliPackRegistry> => {
    packs ??= loadCliPackRegistry(host).then((loaded) => {
      // A pack that failed to load leaves its directives as a labeled
      // fallback in the findings; the reason goes to the client's log.
      for (const line of loaded.failureLines) server?.notice(line);
      return loaded;
    });
    return packs;
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
        const loaded = await loadPacks();
        return noteDiagnostics(text, {
          registry: loaded.registry,
          unavailable: loaded.unavailable,
        });
      },
    });
    const running = server;
    stdio.onData((chunk) => running.receive(chunk));
    stdio.onEnd(() => running.streamEnded());
  });
}
