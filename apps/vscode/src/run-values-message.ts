/**
 * The `values` wire message one completed run produces, built from the
 * shared host's outcome. `vscode`-free so Vitest can reach it: the run
 * itself (grant flow, diagnostics lines, the persisted `RunTrace`) all
 * happens inside `@markii/host`'s `createMarkiiHost(adapter).run`, and
 * `preview-panel.ts` only forwards the result.
 *
 * The `lastRun` marker comes from the trace the shared run path just
 * persisted, so the in-page marker and the stored trace cannot disagree.
 */
import type { RunOutcome } from '@markii/host';
import type { ValuesMessage } from './protocol.js';

export type RanOutcome = Extract<RunOutcome, { kind: 'ran' }>;

export function valuesMessageForRun(
  revision: number,
  outcome: RanOutcome,
): ValuesMessage {
  const { trace } = outcome;
  return {
    type: 'values',
    revision,
    values: outcome.values,
    failures: outcome.failures,
    lastRun: {
      trigger: trace.trigger,
      ranAt: trace.ranAt,
      ok: trace.ok,
      ...(trace.reason !== undefined ? { reason: trace.reason } : {}),
    },
  };
}
