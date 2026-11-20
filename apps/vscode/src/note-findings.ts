/**
 * Maps a note's findings (`@markii/host`'s `checkNote`) onto the plain
 * shape the extension publishes to its Problems collection. No `vscode`
 * import: `extension.ts` turns each entry into a `vscode.Diagnostic`.
 *
 * Every finding is a warning. The page draws the same problem as a quiet
 * marker, so the editor does not raise it to an error.
 */
import type { DiagnosticEvent } from '@markii/stdlib';

/** The name shown beside each problem. */
export const NOTE_FINDING_SOURCE = 'markii';

/** The delay between the last change and a check, in milliseconds. */
export const NOTE_CHECK_DEBOUNCE_MS = 300;

/** One problem, in zero-based editor coordinates with an exclusive end. */
export interface NoteProblem {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly severity: 'warning';
  readonly message: string;
  /** The finding's kind, for the problem's code column. */
  readonly code: string;
  readonly source: typeof NOTE_FINDING_SOURCE;
}

/**
 * A finding with no position is placed on the first line, so it still
 * reaches the Problems panel. A position is one-based with an exclusive
 * end, so each coordinate drops by one.
 */
export function noteProblems(
  findings: readonly DiagnosticEvent[],
): NoteProblem[] {
  return findings.map((finding) => {
    const at = finding.position;
    return {
      startLine: at ? Math.max(0, at.startLine - 1) : 0,
      startColumn: at ? Math.max(0, at.startColumn - 1) : 0,
      endLine: at ? Math.max(0, at.endLine - 1) : 0,
      endColumn: at ? Math.max(0, at.endColumn - 1) : 0,
      severity: 'warning',
      message: finding.message,
      code: finding.kind,
      source: NOTE_FINDING_SOURCE,
    };
  });
}
