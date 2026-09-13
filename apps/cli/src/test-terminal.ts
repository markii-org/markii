/**
 * A fake `Terminal` (see `terminal.ts`) for tests. Not shipped in the
 * built CLI: nothing outside `*.test.ts` files imports this module.
 */
import type { Terminal } from './terminal.js';

export interface FakeTerminal extends Terminal {
  readonly outLines: string[];
  readonly errLines: string[];
  /** Queued answers `ask` resolves with, in call order; an exhausted queue resolves `''`. */
  readonly askAnswers: string[];
  readonly askedQuestions: string[];
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

  return {
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
