/**
 * The IO seam. Together with `main.ts`, this is the ONLY module in this
 * app allowed to read `process` or write directly to stdout/stderr — every
 * other module takes a `Terminal` (or the plain values it exposes) as an
 * argument instead, so it stays testable with a fake.
 */
import * as readline from 'node:readline/promises';

export interface Terminal {
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
