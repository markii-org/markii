/**
 * The three grant prompts (`@markii/host`'s `PromptHost`, `PromptUnknownHosts`,
 * `PromptManyHosts`) as terminal questions. Wording is never invented here:
 * every message comes from `@markii/host`'s exported builders
 * (`hostPromptMessage`, `manyHostsPromptMessage`,
 * `UNKNOWN_HOSTS_PROMPT_MESSAGE`) so the CLI asks exactly what the GUI
 * hosts ask.
 *
 * When stdin is not a TTY, every prompt resolves `false` WITHOUT asking:
 * a grant cannot be given non-interactively, and there is no `--yes` flag
 * to bypass that. The reason is written to stderr once per run via
 * `onNonInteractiveDenial`, so a scripted invocation isn't left silently
 * wondering why nothing was granted.
 */
import {
  hostPromptMessage,
  manyHostsPromptMessage,
  UNKNOWN_HOSTS_PROMPT_MESSAGE,
} from '@markii/host';
import type { Terminal } from './terminal.js';

const PROMPT_SUFFIX = ' [y/N]';

/** `y`/`yes`, case-insensitive, means allow; anything else (including an empty line) means deny. */
function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

const NON_INTERACTIVE_REASON =
  'A grant cannot be given non-interactively; run markii in a terminal to allow network access.';

export interface TerminalPrompts {
  readonly promptHost: (
    host: string,
    declaredHosts: readonly string[],
  ) => Promise<boolean>;
  readonly promptUnknownHosts: () => Promise<boolean>;
  readonly promptManyHosts: (hostCount: number) => Promise<boolean>;
}

/**
 * Builds the three grant prompts against `terminal`. `onNonInteractiveDenial`
 * is called at most once, the first time a prompt would have asked but
 * couldn't (stdin is not a TTY) — callers wire it to write the reason to
 * stderr exactly once per run rather than once per denied prompt.
 */
export function createTerminalPrompts(
  terminal: Terminal,
  onNonInteractiveDenial: (reason: string) => void = () => {},
): TerminalPrompts {
  let warned = false;
  function denyNonInteractive(): boolean {
    if (!warned) {
      warned = true;
      onNonInteractiveDenial(NON_INTERACTIVE_REASON);
    }
    return false;
  }

  return {
    async promptHost(
      host: string,
      declaredHosts: readonly string[],
    ): Promise<boolean> {
      if (!terminal.stdinIsTty) return denyNonInteractive();
      const answer = await terminal.ask(
        `${hostPromptMessage(host, declaredHosts)}${PROMPT_SUFFIX} `,
      );
      return isAffirmative(answer);
    },
    async promptUnknownHosts(): Promise<boolean> {
      if (!terminal.stdinIsTty) return denyNonInteractive();
      const answer = await terminal.ask(
        `${UNKNOWN_HOSTS_PROMPT_MESSAGE}${PROMPT_SUFFIX} `,
      );
      return isAffirmative(answer);
    },
    async promptManyHosts(hostCount: number): Promise<boolean> {
      if (!terminal.stdinIsTty) return denyNonInteractive();
      const answer = await terminal.ask(
        `${manyHostsPromptMessage(hostCount)}${PROMPT_SUFFIX} `,
      );
      return isAffirmative(answer);
    },
  };
}
