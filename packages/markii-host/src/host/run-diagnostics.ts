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
