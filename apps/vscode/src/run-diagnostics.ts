import type { RunOnceResult } from '@markii/host';

/**
 * The lines the Markii output channel gets for one run's script failures
 * (GitHub issue #37). Obsidian already writes each failure to its console,
 * the diagnostics surface named in docs/integration.md; VS Code showed
 * them only as value-marker tooltips and the run marker, which a hidden or
 * collapsed marker can bury. This is the "second home" AGENTS.md's
 * "clean is not silent" rule requires: one line per failed script, with
 * its name, its failure kind, and the same short reason the tooltip
 * carries. No failures, no lines: the channel stays quiet on a clean run.
 */
export function formatRunFailureLines(
  failures: RunOnceResult['failureDetails'],
): string[] {
  return failures.map(
    (failure) => `${failure.name} (${failure.kind}): ${failure.message}`,
  );
}
