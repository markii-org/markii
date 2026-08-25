import { describe, expect, it } from 'vitest';
import {
  isRunTrace,
  lastRunStorageKeyFor,
  readLastRunTrace,
  writeLastRunTrace,
} from './run-trace.js';
import type { RunTrace } from './run-trace.js';
import type { GrantMemento } from './grant-flow.js';

function fakeMemento(initial: Record<string, unknown> = {}): GrantMemento {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      store.has(key) ? (store.get(key) as T) : defaultValue,
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
}

describe('isRunTrace', () => {
  it('accepts a well-formed successful trace', () => {
    expect(isRunTrace({ trigger: 'scheduled', ranAt: 1000, ok: true })).toBe(
      true,
    );
  });

  it('accepts a well-formed failed trace with a reason', () => {
    expect(
      isRunTrace({
        trigger: 'auto',
        ranAt: 1000,
        ok: false,
        reason: 'timed out',
      }),
    ).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(isRunTrace(null)).toBe(false);
    expect(isRunTrace('trace')).toBe(false);
  });

  it('rejects an invalid trigger', () => {
    expect(isRunTrace({ trigger: 'nightly', ranAt: 1000, ok: true })).toBe(
      false,
    );
  });

  it('rejects a non-finite ranAt', () => {
    expect(isRunTrace({ trigger: 'manual', ranAt: Infinity, ok: true })).toBe(
      false,
    );
  });

  it('rejects a non-boolean ok', () => {
    expect(isRunTrace({ trigger: 'manual', ranAt: 1000, ok: 'yes' })).toBe(
      false,
    );
  });

  it('rejects a non-string reason', () => {
    expect(
      isRunTrace({ trigger: 'manual', ranAt: 1000, ok: false, reason: 42 }),
    ).toBe(false);
  });
});

describe('readLastRunTrace / writeLastRunTrace', () => {
  it('round-trips a written trace', async () => {
    const memento = fakeMemento();
    const trace: RunTrace = { trigger: 'scheduled', ranAt: 5000, ok: true };
    await writeLastRunTrace(memento, 'doc-1', trace);
    expect(readLastRunTrace(memento, 'doc-1')).toEqual(trace);
  });

  it('returns undefined when nothing is persisted', () => {
    expect(readLastRunTrace(fakeMemento(), 'doc-1')).toBeUndefined();
  });

  it('returns undefined for a corrupt persisted value', () => {
    const memento = fakeMemento({
      [lastRunStorageKeyFor('doc-1')]: { garbage: true },
    });
    expect(readLastRunTrace(memento, 'doc-1')).toBeUndefined();
  });

  it('keys different documents independently', async () => {
    const memento = fakeMemento();
    const traceA: RunTrace = { trigger: 'manual', ranAt: 1, ok: true };
    const traceB: RunTrace = {
      trigger: 'auto',
      ranAt: 2,
      ok: false,
      reason: 'x',
    };
    await writeLastRunTrace(memento, 'a', traceA);
    await writeLastRunTrace(memento, 'b', traceB);
    expect(readLastRunTrace(memento, 'a')).toEqual(traceA);
    expect(readLastRunTrace(memento, 'b')).toEqual(traceB);
  });
});
