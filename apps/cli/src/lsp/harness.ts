/**
 * An in-process LSP client for tests: it feeds framed requests to
 * `createLspServer` and reads framed replies back, with the real shared
 * host behind completion and hover. Not shipped; only `*.test.ts` files
 * import it.
 */
import { standardNoteCatalog } from '@markii/stdlib';
import { createMarkiiHost } from '@markii/host';
import { createCliHostAdapter } from '../host-adapter.js';
import { createFakeTerminal } from '../test-terminal.js';
import { createFrameParser, encodeFrame } from './frames.js';
import { noteDiagnostics } from './note-diagnostics.js';
import { createLspServer, type LspServer } from './server.js';

/** A decoded JSON-RPC payload in a test: shapes are asserted by the test itself. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface Reply {
  readonly id?: number | string | null;
  readonly method?: string;
  readonly result?: Json;
  readonly error?: { code: number; message: string };
  readonly params?: Json;
}

export interface Harness {
  readonly server: LspServer;
  readonly exits: number[];
  readonly logs: string[];
  /** Every message the server has written so far. */
  readonly out: Reply[];
  /** Sends one message as a single frame. */
  notify(method: string, params?: unknown): void;
  /** Sends a request and resolves with its reply. */
  request(method: string, params?: unknown): Promise<Reply>;
  /** Waits for the server to finish everything, then returns the notifications of `method`. */
  published(method: string): Promise<Reply[]>;
  initialize(capabilities?: unknown): Promise<Reply>;
  open(uri: string, text: string): void;
}

export function createHarness(options: { debounceMs?: number } = {}): Harness {
  const out: Reply[] = [];
  const parser = createFrameParser();
  const exits: number[] = [];
  const logs: string[] = [];
  const terminal = createFakeTerminal();
  const host = createMarkiiHost(
    createCliHostAdapter({
      terminal,
      memento: {
        get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
        update: (): Promise<void> => Promise.resolve(),
      },
      editor: {
        documentText: () => '',
        documentPath: () => undefined,
        cursor: () => ({ line: 0, column: 0 }),
        applyEdits: () => Promise.resolve(false),
      },
    }),
  );
  const server = createLspServer({
    serverVersion: 'test',
    debounceMs: options.debounceMs ?? 0,
    write: (frame) => {
      for (const item of parser.push(frame)) {
        if (item.kind === 'message') out.push(item.value as Reply);
      }
    },
    log: (line) => logs.push(line),
    exit: (code) => exits.push(code),
    completeAt: (request) => host.completeAt(request),
    hoverAt: (request) => host.hoverAt(request),
    diagnose: (text) =>
      Promise.resolve(noteDiagnostics(text, standardNoteCatalog())),
  });
  let nextId = 1;

  const harness: Harness = {
    server,
    exits,
    logs,
    out,
    notify(method, params) {
      server.receive(encodeFrame({ jsonrpc: '2.0', method, params }));
    },
    async request(method, params) {
      const id = nextId++;
      server.receive(encodeFrame({ jsonrpc: '2.0', id, method, params }));
      await server.idle();
      const reply = out.find((message) => message.id === id);
      if (reply === undefined) throw new Error(`no reply to ${method}`);
      return reply;
    },
    async published(method) {
      await server.idle();
      return out.filter((message) => message.method === method);
    },
    async initialize(capabilities = {}) {
      const reply = await harness.request('initialize', {
        processId: null,
        rootUri: null,
        capabilities,
      });
      harness.notify('initialized', {});
      return reply;
    },
    open(uri, text) {
      harness.notify('textDocument/didOpen', {
        textDocument: { uri, languageId: 'markii', version: 1, text },
      });
    },
  };
  return harness;
}
