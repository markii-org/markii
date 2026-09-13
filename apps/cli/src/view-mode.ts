/**
 * The pure decision behind `markii view`'s mode: live (a mounted Ink app)
 * or static (render once to a string and exit). Takes plain booleans so it
 * stays testable with the existing fake terminal without spawning a real
 * TTY: `main.ts` calls this with `terminal.stdinIsTty`/`terminal.stdoutIsTty`
 * and the parsed `--static` flag.
 */
export interface ViewModeInput {
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly staticFlag: boolean;
}

export type ViewMode = 'live' | 'static';

/**
 * `--static` always wins. Otherwise, the live viewer mounts only when BOTH
 * stdin and stdout are terminals; a pipe, a redirect, or either stream not
 * being a TTY keeps the render-once path exactly as it always has been.
 */
export function resolveViewMode(input: ViewModeInput): ViewMode {
  if (input.staticFlag) return 'static';
  if (input.stdinIsTty && input.stdoutIsTty) return 'live';
  return 'static';
}
