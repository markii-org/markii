import { describe, expect, it } from 'vitest';
import { valuesMessageForRun, type RanOutcome } from './run-values-message.js';

function outcome(over: Partial<RanOutcome> = {}): RanOutcome {
  return {
    kind: 'ran',
    values: {},
    failures: [],
    failureDetails: [],
    netDeclarationDiagnostics: [],
    trace: { trigger: 'manual', ranAt: 5, ok: true },
    ...over,
  };
}

describe('valuesMessageForRun', () => {
  it('carries the shared trace as the in-page run marker', () => {
    const message = valuesMessageForRun(7, outcome());
    expect(message).toMatchObject({
      type: 'values',
      revision: 7,
      lastRun: { trigger: 'manual', ranAt: 5, ok: true },
    });
    expect(message.lastRun).not.toHaveProperty('reason');
  });

  it('keeps a failed run marked failed, with its reason and failures', () => {
    const message = valuesMessageForRun(
      1,
      outcome({
        failures: [{ name: 'a', kind: 'script-error' }],
        trace: {
          trigger: 'auto',
          ranAt: 9,
          ok: false,
          reason: '1 script failed',
        },
      }),
    );
    expect(message.lastRun).toEqual({
      trigger: 'auto',
      ranAt: 9,
      ok: false,
      reason: '1 script failed',
    });
    expect(message.failures).toHaveLength(1);
  });
});
