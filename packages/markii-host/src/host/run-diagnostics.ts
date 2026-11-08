import type { RunTrigger } from '@markii/runtime';
import type { RunOnceResult } from '../run/run-flow.js';

/**
 * The lines a host's diagnostics surface gets for one run's script
 * failures (GitHub issue #37), moved here from
 * `apps/vscode/src/run-diagnostics.ts` so Obsidian gains the same
 * behavior instead of writing its own copy (it previously wrote each
 * failure to its console ad hoc; VS Code showed them only as value-marker
 * tooltips and the run marker, which a hidden or collapsed marker can
 * bury). This is the "second home" AGENTS.md's "clean is not silent" rule
 * requires: one line per failed script, with its name, its failure kind,
 * and the same short reason the tooltip carries. No failures, no lines:
 * the surface stays quiet on a clean run.
 */
export function formatRunFailureLines(
  failures: RunOnceResult['failureDetails'],
): string[] {
  return failures.map(
    (failure) => `${failure.name} (${failure.kind}): ${failure.message}`,
  );
}

/**
 * Every diagnostics line one completed run owes the host's surface, in
 * the order they are written: a header and one indented line per failed
 * script (the "second home" of each failure, `formatRunFailureLines`),
 * then a header and the lines of any net-declaration mismatch. A clean
 * run with agreeing declarations returns no lines, so an empty surface
 * still means nothing went wrong.
 */
export function runDiagnosticLines(
  trigger: RunTrigger,
  result: Pick<RunOnceResult, 'failureDetails' | 'netDeclarationDiagnostics'>,
): string[] {
  const lines: string[] = [];
  const failureLines = formatRunFailureLines(result.failureDetails);
  if (failureLines.length > 0) {
    lines.push(
      `${trigger} run finished with ${String(failureLines.length)} script failure(s):`,
    );
    for (const line of failureLines) lines.push(`  ${line}`);
  }
  if (result.netDeclarationDiagnostics.length > 0) {
    lines.push(`${trigger} run: net declaration mismatch:`);
    for (const line of result.netDeclarationDiagnostics) {
      lines.push(`  ${line}`);
    }
  }
  return lines;
}

/** The one line a run that threw (rather than returning failures) owes the diagnostics surface. */
export function runCrashDiagnosticLine(
  trigger: RunTrigger,
  detail: string,
): string {
  return `${trigger} run failed before it could report: ${detail}`;
}
