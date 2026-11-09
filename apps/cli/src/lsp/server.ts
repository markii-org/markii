/**
 * The Markii language server's protocol half. It translates between LSP
 * and the host's editor behaviors (`createMarkiiHost`'s `completeAt` and
 * `hoverAt`, the note render's diagnostics) and holds no Markii logic of
 * its own: every completion item, hover text, fence edit, and diagnostic
 * message arrives from the shared layer already worded.
 *
 * Everything it touches comes in through `LspServerDeps`, so a test feeds
 * it framed bytes and reads framed bytes back with no process, no stdio,
 * and no clock. It never writes anything but protocol frames through
 * `deps.write`; its own logs go to `deps.log` (stderr in the real CLI) and
 * to `window/logMessage`.
 *
 * Only documents whose URI ends in `.mk.md` get behaviors. Scripts never
 * run here and nothing here touches the network.
 */
import {
  completionOriginTag,
  isContainerCompletionItem,
  type CompleteOutcome,
  type EditorPositionRequest,
  type HoverOutcome,
} from '@markii/host';
import {
  formatComponentDocumentation,
  type CompletionItem,
} from '@markii/stdlib/editor';
import type { DiagnosticEvent } from '@markii/stdlib';
import { createFrameParser, encodeFrame } from './frames.js';
import {
  clientToSeamColumn,
  negotiateEncoding,
  seamToClientColumn,
  type PositionEncoding,
} from './positions.js';

/** The characters that (re)open completion while typing a directive; the same set the VS Code host registers. */
export const LSP_TRIGGER_CHARACTERS: readonly string[] = [
  ':',
  '{',
  '=',
  '"',
  ' ',
];

/** How long a quiet edit waits before the note is checked again. */
export const DIAGNOSTICS_DEBOUNCE_MS = 150;

const ERROR_PARSE = -32700;
const ERROR_INVALID_REQUEST = -32600;
const ERROR_METHOD_NOT_FOUND = -32601;
const ERROR_INVALID_PARAMS = -32602;
const ERROR_SERVER_NOT_INITIALIZED = -32002;

const COMPLETION_KIND_CLASS = 7;
const COMPLETION_KIND_PROPERTY = 10;
const COMPLETION_KIND_ENUM_MEMBER = 20;
const SEVERITY_WARNING = 2;
const MESSAGE_ERROR = 1;
const MESSAGE_INFO = 3;

export interface LspServerDeps {
  /** Receives each outgoing frame, complete with its header. */
  write(frame: Uint8Array): void;
  /** A free-form line for the server's own log (stderr). Never stdout. */
  log(line: string): void;
  /** Ends the process. Called once, on `exit` or when the stream ends. */
  exit(code: number): void;
  completeAt(request: EditorPositionRequest): Promise<CompleteOutcome>;
  hoverAt(request: EditorPositionRequest): Promise<HoverOutcome>;
  /** The render's findings for a note. Never run scripts, never touch the network. */
  diagnose(text: string): Promise<readonly DiagnosticEvent[]>;
  readonly serverVersion: string;
  readonly debounceMs?: number;
}

export interface LspServer {
  /** Feeds bytes from the client's stdout. */
  receive(chunk: Uint8Array): void;
  /** The client closed the stream: exits like `exit` would. */
  streamEnded(): void;
  /** A line for the server's log: stderr, and `window/logMessage` once a client is connected. For findings about the server's own setup, such as a pack that failed to load. */
  notice(line: string): void;
  /** Resolves once every message received so far is handled and every scheduled check has published. For tests and orderly shutdown. */
  idle(): Promise<void>;
}

interface OpenDocument {
  text: string;
  version: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

type Id = string | number | null;

interface LspPosition {
  line: number;
  character: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMarkiiUri(uri: string): boolean {
  return uri.toLowerCase().endsWith('.mk.md');
}

function readPosition(value: unknown): LspPosition | undefined {
  if (!isRecord(value)) return undefined;
  const { line, character } = value;
  if (
    typeof line !== 'number' ||
    typeof character !== 'number' ||
    !Number.isInteger(line) ||
    !Number.isInteger(character) ||
    line < 0 ||
    character < 0
  ) {
    return undefined;
  }
  return { line, character };
}

function readUri(params: unknown): string | undefined {
  if (!isRecord(params) || !isRecord(params.textDocument)) return undefined;
  const { uri } = params.textDocument;
  return typeof uri === 'string' ? uri : undefined;
}

/** Escapes the three characters LSP snippet syntax treats as markup. */
function escapeSnippet(text: string): string {
  return text.replace(/[\\$}]/g, (ch) => `\\${ch}`);
}

export function createLspServer(deps: LspServerDeps): LspServer {
  const documents = new Map<string, OpenDocument>();
  const debounceMs = deps.debounceMs ?? DIAGNOSTICS_DEBOUNCE_MS;
  const parser = createFrameParser();
  const running = new Set<Promise<void>>();

  let state: 'new' | 'running' | 'shutdown' | 'exited' = 'new';
  let shutdownRequested = false;
  let encoding: PositionEncoding = 'utf-16';
  let snippetSupport = false;
  let queue: Promise<void> = Promise.resolve();

  function send(message: Record<string, unknown>): void {
    deps.write(encodeFrame({ jsonrpc: '2.0', ...message }));
  }

  function respond(id: Id, result: unknown): void {
    send({ id, result });
  }

  function respondError(id: Id, code: number, message: string): void {
    send({ id, error: { code, message } });
  }

  function logMessage(type: number, message: string): void {
    deps.log(message);
    if (state === 'running' || state === 'shutdown') {
      send({ method: 'window/logMessage', params: { type, message } });
    }
  }

  function toClientColumn(line: string, column: number): number {
    return seamToClientColumn(line, column, encoding);
  }

  function lspRange(
    lines: readonly string[],
    line: number,
    startColumn: number,
    endColumn: number,
  ): Record<string, unknown> {
    const text = lines[line] ?? '';
    return {
      start: { line, character: toClientColumn(text, startColumn) },
      end: { line, character: toClientColumn(text, endColumn) },
    };
  }

  // ---- completion --------------------------------------------------------

  function completionItem(
    item: CompletionItem,
    index: number,
    outcome: Extract<CompleteOutcome, { kind: 'completions' }>,
    line: number,
    lines: readonly string[],
  ): Record<string, unknown> {
    const lineText = lines[line] ?? '';
    const asSnippet =
      snippetSupport &&
      item.insertCursorOffset >= 0 &&
      item.insertCursorOffset < item.insertText.length;
    const newText = asSnippet
      ? `${escapeSnippet(item.insertText.slice(0, item.insertCursorOffset))}$0${escapeSnippet(
          item.insertText.slice(item.insertCursorOffset),
        )}`
      : item.insertText;
    // A client scores candidates against the text from the edit's start to
    // the cursor, which for a directive name begins at the colon run.
    const colonRun = lineText.slice(outcome.replaceStart, outcome.tokenStart);
    const result: Record<string, unknown> = {
      label: item.label,
      kind:
        item.kind === 'component'
          ? COMPLETION_KIND_CLASS
          : item.kind === 'attribute'
            ? COMPLETION_KIND_PROPERTY
            : COMPLETION_KIND_ENUM_MEMBER,
      detail:
        item.kind === 'component' ? completionOriginTag(item) : item.detail,
      sortText: String(index).padStart(5, '0'),
      filterText: `${colonRun}${item.label}`,
      insertTextFormat: asSnippet ? 2 : 1,
      textEdit: {
        range: lspRange(lines, line, outcome.replaceStart, outcome.replaceEnd),
        newText,
      },
    };
    if (item.documentation !== undefined) {
      const value = formatComponentDocumentation(item.documentation);
      if (value !== '') {
        result.documentation = { kind: 'plaintext', value };
      }
    }
    if (outcome.fenceEdits.length > 0 && isContainerCompletionItem(item)) {
      result.additionalTextEdits = outcome.fenceEdits.map((edit) => ({
        range: lspRange(lines, edit.line, edit.startColumn, edit.endColumn),
        newText: edit.text,
      }));
    }
    return result;
  }

  async function handleCompletion(id: Id, params: unknown): Promise<void> {
    const uri = readUri(params);
    const position = isRecord(params)
      ? readPosition(params.position)
      : undefined;
    if (uri === undefined || position === undefined) {
      respondError(
        id,
        ERROR_INVALID_PARAMS,
        'textDocument and position are required',
      );
      return;
    }
    const document = documents.get(uri);
    if (document === undefined || !isMarkiiUri(uri)) {
      respond(id, null);
      return;
    }
    const lines = document.text.split('\n');
    const lineText = lines[position.line] ?? '';
    const outcome = await deps.completeAt({
      line: position.line,
      column: clientToSeamColumn(lineText, position.character, encoding),
      documentText: document.text,
    });
    if (outcome.kind !== 'completions') {
      respond(id, null);
      return;
    }
    respond(id, {
      isIncomplete: false,
      items: outcome.items.map((item, index) =>
        completionItem(item, index, outcome, position.line, lines),
      ),
    });
  }

  async function handleHover(id: Id, params: unknown): Promise<void> {
    const uri = readUri(params);
    const position = isRecord(params)
      ? readPosition(params.position)
      : undefined;
    if (uri === undefined || position === undefined) {
      respondError(
        id,
        ERROR_INVALID_PARAMS,
        'textDocument and position are required',
      );
      return;
    }
    const document = documents.get(uri);
    if (document === undefined || !isMarkiiUri(uri)) {
      respond(id, null);
      return;
    }
    const lines = document.text.split('\n');
    const lineText = lines[position.line] ?? '';
    const outcome = await deps.hoverAt({
      line: position.line,
      column: clientToSeamColumn(lineText, position.character, encoding),
      documentText: document.text,
    });
    if (outcome.kind !== 'hover') {
      respond(id, null);
      return;
    }
    respond(id, {
      contents: { kind: 'plaintext', value: outcome.text },
      range: lspRange(lines, position.line, outcome.start, outcome.end),
    });
  }

  // ---- diagnostics -------------------------------------------------------

  function diagnosticFor(
    event: DiagnosticEvent,
    lines: readonly string[],
  ): Record<string, unknown> {
    const at = event.position;
    let range: Record<string, unknown>;
    if (at === undefined) {
      range = lspRange(lines, 0, 0, 0);
    } else {
      const startLine = Math.max(0, at.startLine - 1);
      // A container directive spans its whole body; mark the opening line.
      const endsLater = at.endLine > at.startLine;
      const endColumn = endsLater
        ? (lines[startLine] ?? '').length
        : at.endColumn - 1;
      range = lspRange(lines, startLine, at.startColumn - 1, endColumn);
    }
    return {
      range,
      severity: SEVERITY_WARNING,
      code: event.kind,
      source: 'markii',
      message: event.message,
    };
  }

  async function publishDiagnostics(uri: string): Promise<void> {
    const document = documents.get(uri);
    if (document === undefined) return;
    const { text, version } = document;
    let events: readonly DiagnosticEvent[];
    try {
      events = await deps.diagnose(text);
    } catch (error) {
      logMessage(
        MESSAGE_ERROR,
        `could not check ${uri}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const current = documents.get(uri);
    if (current === undefined || current.version !== version) return;
    if (state === 'exited') return;
    const lines = text.split('\n');
    const seen = new Set<string>();
    const diagnostics: Record<string, unknown>[] = [];
    for (const event of events) {
      const key = JSON.stringify([event.kind, event.message, event.position]);
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(diagnosticFor(event, lines));
    }
    send({
      method: 'textDocument/publishDiagnostics',
      params: { uri, version, diagnostics },
    });
  }

  function scheduleDiagnostics(uri: string, delay: number): void {
    const document = documents.get(uri);
    if (document === undefined || !isMarkiiUri(uri)) return;
    if (document.timer !== undefined) clearTimeout(document.timer);
    document.timer = setTimeout(() => {
      document.timer = undefined;
      const job = publishDiagnostics(uri).catch((error: unknown) => {
        deps.log(
          `diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      running.add(job);
      void job.finally(() => running.delete(job));
    }, delay);
  }

  // ---- lifecycle and sync ------------------------------------------------

  function handleInitialize(id: Id, params: unknown): void {
    const general =
      isRecord(params) && isRecord(params.capabilities)
        ? params.capabilities
        : {};
    const offered = isRecord(general.general)
      ? general.general.positionEncodings
      : undefined;
    encoding = negotiateEncoding(offered);
    const textDocument = isRecord(general.textDocument)
      ? general.textDocument
      : {};
    const completion = isRecord(textDocument.completion)
      ? textDocument.completion
      : {};
    snippetSupport =
      isRecord(completion.completionItem) &&
      completion.completionItem.snippetSupport === true;
    state = 'running';
    respond(id, {
      capabilities: {
        ...(Array.isArray(offered) ? { positionEncoding: encoding } : {}),
        textDocumentSync: { openClose: true, change: 1 },
        completionProvider: {
          triggerCharacters: [...LSP_TRIGGER_CHARACTERS],
          resolveProvider: false,
        },
        hoverProvider: true,
      },
      serverInfo: { name: 'markii', version: deps.serverVersion },
    });
  }

  function handleDidOpen(params: unknown): void {
    if (!isRecord(params) || !isRecord(params.textDocument)) return;
    const { uri, text, version } = params.textDocument;
    if (typeof uri !== 'string' || typeof text !== 'string') return;
    const previous = documents.get(uri);
    if (previous?.timer !== undefined) clearTimeout(previous.timer);
    documents.set(uri, {
      text,
      version: typeof version === 'number' ? version : 0,
      timer: undefined,
    });
    scheduleDiagnostics(uri, 0);
  }

  function handleDidChange(params: unknown): void {
    const uri = readUri(params);
    if (uri === undefined || !isRecord(params)) return;
    const document = documents.get(uri);
    if (document === undefined) return;
    const changes = params.contentChanges;
    if (!Array.isArray(changes) || changes.length === 0) return;
    // Full sync is what the server advertises: the last entry is the text.
    const last: unknown = changes[changes.length - 1];
    if (!isRecord(last) || typeof last.text !== 'string') return;
    if (last.range !== undefined) {
      logMessage(
        MESSAGE_INFO,
        'ignored an incremental change: this server asked for full document sync',
      );
      return;
    }
    const doc = params.textDocument;
    const version =
      isRecord(doc) && typeof doc.version === 'number'
        ? doc.version
        : document.version + 1;
    document.text = last.text;
    document.version = version;
    scheduleDiagnostics(uri, debounceMs);
  }

  function handleDidClose(params: unknown): void {
    const uri = readUri(params);
    if (uri === undefined) return;
    const document = documents.get(uri);
    if (document === undefined) return;
    if (document.timer !== undefined) clearTimeout(document.timer);
    documents.delete(uri);
    if (isMarkiiUri(uri)) {
      send({
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics: [] },
      });
    }
  }

  function doExit(code: number): void {
    if (state === 'exited') return;
    state = 'exited';
    for (const document of documents.values()) {
      if (document.timer !== undefined) clearTimeout(document.timer);
    }
    deps.exit(code);
  }

  async function dispatch(message: unknown): Promise<void> {
    if (!isRecord(message) || typeof message.method !== 'string') {
      // A response to a request this server never made, or junk.
      if (isRecord(message) && 'id' in message && !('result' in message)) {
        const id = message.id;
        if (typeof id === 'string' || typeof id === 'number') {
          respondError(id, ERROR_INVALID_REQUEST, 'not a request');
        }
      }
      return;
    }
    const { method, params } = message;
    const hasId = 'id' in message;
    const rawId = message.id;
    const id: Id =
      typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;

    if (method === 'exit') {
      doExit(shutdownRequested ? 0 : 1);
      return;
    }
    if (state === 'new') {
      if (method === 'initialize' && hasId) {
        handleInitialize(id, params);
      } else if (hasId) {
        respondError(
          id,
          ERROR_SERVER_NOT_INITIALIZED,
          'the server is not initialized',
        );
      }
      return;
    }
    if (state === 'shutdown') {
      if (hasId) {
        respondError(id, ERROR_INVALID_REQUEST, 'the server is shutting down');
      }
      return;
    }

    switch (method) {
      case 'initialize':
        respondError(id, ERROR_INVALID_REQUEST, 'already initialized');
        return;
      case 'initialized':
        return;
      case 'shutdown':
        shutdownRequested = true;
        state = 'shutdown';
        for (const document of documents.values()) {
          if (document.timer !== undefined) clearTimeout(document.timer);
          document.timer = undefined;
        }
        respond(id, null);
        return;
      case 'textDocument/didOpen':
        handleDidOpen(params);
        return;
      case 'textDocument/didChange':
        handleDidChange(params);
        return;
      case 'textDocument/didClose':
        handleDidClose(params);
        return;
      case 'textDocument/completion':
        if (hasId) await handleCompletion(id, params);
        return;
      case 'textDocument/hover':
        if (hasId) await handleHover(id, params);
        return;
      default:
        if (hasId) {
          respondError(
            id,
            ERROR_METHOD_NOT_FOUND,
            `method not found: ${method}`,
          );
        }
    }
  }

  function enqueue(message: unknown): void {
    queue = queue.then(async () => {
      try {
        await dispatch(message);
      } catch (error) {
        deps.log(
          `internal error: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (
          isRecord(message) &&
          'id' in message &&
          (typeof message.id === 'string' || typeof message.id === 'number')
        ) {
          respondError(message.id, -32603, 'internal error');
        }
      }
    });
  }

  return {
    receive(chunk: Uint8Array): void {
      if (state === 'exited') return;
      for (const item of parser.push(chunk)) {
        if (item.kind === 'message') {
          enqueue(item.value);
        } else {
          deps.log(`dropped a bad frame: ${item.reason}`);
          queue = queue.then(() => {
            respondError(null, ERROR_PARSE, item.reason);
          });
        }
      }
    },
    streamEnded(): void {
      queue = queue.then(() => doExit(shutdownRequested ? 0 : 1));
    },
    notice(line: string): void {
      logMessage(MESSAGE_ERROR, line);
    },
    async idle(): Promise<void> {
      for (;;) {
        await queue;
        // A check scheduled by the handled messages fires on a timer.
        const waiting = [...documents.values()].some(
          (document) => document.timer !== undefined,
        );
        if (running.size === 0 && !waiting) return;
        if (running.size > 0) await Promise.all([...running]);
        else await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
    },
  };
}
