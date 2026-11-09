/**
 * The IO seam. Together with `main.ts`, this is the ONLY module in this
 * app allowed to read `process` or write directly to stdout/stderr — every
 * other module takes a `Terminal` (or the plain values it exposes) as an
 * argument instead, so it stays testable with a fake.
 */
import * as readline from 'node:readline/promises';

/**
 * The raw byte streams `markii lsp` speaks over: the client's writes in,
 * protocol frames out. Opening claims stdout for protocol frames alone,
 * so a stray `console.log` (a pack's, say) goes to stderr instead of
 * corrupting a frame. `release` hands both back and lets the process end.
 */
export interface TerminalStdio {
  onData(listener: (chunk: Uint8Array) => void): void;
  onEnd(listener: () => void): void;
  write(bytes: Uint8Array): void;
  release(): void;
}

export interface Terminal {
  openStdio(): TerminalStdio;
  write(text: string): void;
  writeError(text: string): void;
  readonly columns: number | undefined;
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly env: Record<string, string | undefined>;
  ask(question: string): Promise<string>;
}

/** The real terminal, backed by `process`. */
export function createNodeTerminal(): Terminal {
  return {
    openStdio(): TerminalStdio {
      const saved = {
        log: console.log,
        info: console.info,
        debug: console.debug,
      };
      const toStderr = (...args: unknown[]): void => {
        process.stderr.write(`${args.map(String).join(' ')}\n`);
      };
      console.log = toStderr;
      console.info = toStderr;
      console.debug = toStderr;
      let onData: ((chunk: Uint8Array) => void) | undefined;
      let onEnd: (() => void) | undefined;
      const dataListener = (chunk: Buffer): void => onData?.(chunk);
      const endListener = (): void => onEnd?.();
      process.stdin.on('data', dataListener);
      process.stdin.on('end', endListener);
      return {
        onData(listener): void {
          onData = listener;
        },
        onEnd(listener): void {
          onEnd = listener;
        },
        write(bytes: Uint8Array): void {
          process.stdout.write(bytes);
        },
        release(): void {
          process.stdin.off('data', dataListener);
          process.stdin.off('end', endListener);
          process.stdin.pause();
          console.log = saved.log;
          console.info = saved.info;
          console.debug = saved.debug;
        },
      };
    },
    write(text: string): void {
      process.stdout.write(text);
    },
    writeError(text: string): void {
      process.stderr.write(text);
    },
    get columns(): number | undefined {
      return process.stdout.columns;
    },
    get stdinIsTty(): boolean {
      return process.stdin.isTTY === true;
    },
    get stdoutIsTty(): boolean {
      return process.stdout.isTTY === true;
    },
    get env(): Record<string, string | undefined> {
      return process.env;
    },
    async ask(question: string): Promise<string> {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}
