/**
 * Formats a note's findings (`@markii/host`'s `checkNote`) as lines for the
 * plugin's diagnostics surface, the developer console. No `obsidian`
 * import. A check runs on every pause in typing, so the reporter writes a
 * note's lines only when they differ from the last lines it wrote for that
 * note: the console shows each problem once, not once per keystroke.
 */
import type { DiagnosticEvent } from '@markii/stdlib';

/** The delay between the last change and a check, in milliseconds. */
export const NOTE_CHECK_DEBOUNCE_MS = 300;

/** One line per finding: the note's path, the one-based source line, the message. A finding with no position carries no line number. */
export function noteFindingLines(
  notePath: string,
  findings: readonly DiagnosticEvent[],
): string[] {
  return findings.map((finding) =>
    finding.position === undefined
      ? `${notePath}: ${finding.message}`
      : `${notePath}:${String(finding.position.startLine)}: ${finding.message}`,
  );
}

export interface NoteFindingsReporter {
  /** Writes the note's lines when they changed since the last report for it. */
  report(notePath: string, findings: readonly DiagnosticEvent[]): void;
  /** Forgets a note, so its next findings are written again. */
  forget(notePath: string): void;
}

export function createNoteFindingsReporter(
  write: (line: string) => void,
): NoteFindingsReporter {
  const last = new Map<string, string>();
  return {
    report(notePath, findings) {
      const lines = noteFindingLines(notePath, findings);
      const signature = JSON.stringify(lines);
      if (last.get(notePath) === signature) return;
      last.set(notePath, signature);
      for (const line of lines) write(line);
    },
    forget(notePath) {
      last.delete(notePath);
    },
  };
}
