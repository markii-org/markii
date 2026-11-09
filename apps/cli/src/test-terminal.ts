/**
 * A fake `Terminal` (see `terminal.ts`) for tests. Not shipped in the
 * built CLI: nothing outside `*.test.ts` files imports this module.
 */
import type { Terminal, TerminalStdio } from './terminal.js';

export interface FakeTerminal extends Terminal {
  readonly outLines: string[];
  readonly errLines: string[];
  /** Queued answers `ask` resolves with, in call order; an exhausted queue resolves `''`. */
  readonly askAnswers: string[];
  readonly askedQuestions: string[];
  /** Bytes `markii lsp` wrote to stdout, in order. */
  readonly stdoutBytes: Uint8Array[];
  /** Feeds bytes to the opened stdio, as the client's stdout would. */
  readonly feed: (bytes: Uint8Array) => void;
  /** Closes the opened stdio's input, as a dying client would. */
  readonly endInput: () => void;
  /** Whether `release` has been called. */
  readonly stdioReleased: () => boolean;
}

export function createFakeTerminal(
  overrides: Partial<{
    columns: number | undefined;
    stdinIsTty: boolean;
    stdoutIsTty: boolean;
    env: Record<string, string | undefined>;
    askAnswers: string[];
  }> = {},
): FakeTerminal {
  const outLines: string[] = [];
  const errLines: string[] = [];
  const askAnswers = [...(overrides.askAnswers ?? [])];
  const askedQuestions: string[] = [];

  const stdoutBytes: Uint8Array[] = [];
  let dataListener: ((chunk: Uint8Array) => void) | undefined;
  let endListener: (() => void) | undefined;
  let released = false;

  return {
    openStdio(): TerminalStdio {
      return {
        onData(listener): void {
          dataListener = listener;
        },
        onEnd(listener): void {
          endListener = listener;
        },
        write(bytes: Uint8Array): void {
          stdoutBytes.push(bytes);
        },
        release(): void {
          released = true;
        },
      };
    },
    stdoutBytes,
    feed: (bytes) => dataListener?.(bytes),
    endInput: () => endListener?.(),
    stdioReleased: () => released,
    outLines,
    errLines,
    askAnswers,
    askedQuestions,
    write(text: string): void {
      outLines.push(text);
    },
    writeError(text: string): void {
      errLines.push(text);
    },
    columns: overrides.columns,
    stdinIsTty: overrides.stdinIsTty ?? false,
    stdoutIsTty: overrides.stdoutIsTty ?? false,
    env: overrides.env ?? {},
    async ask(question: string): Promise<string> {
      askedQuestions.push(question);
      return askAnswers.shift() ?? '';
    },
  };
}
