import { describe, expect, it } from 'vitest';
import type { StoredValue } from '@markii/runtime';
import { staleValuesForRehydration } from './stale-values';

describe('staleValuesForRehydration (issue #11, gap 1)', () => {
  it('demotes a fresh value to stale', () => {
    const out = staleValuesForRehydration({ a: { value: 1, status: 'fresh' } });
    expect(out.a).toEqual({ value: 1, status: 'stale' });
  });

  it('leaves an already-stale value stale', () => {
    const out = staleValuesForRehydration({ a: { value: 1, status: 'stale' } });
    expect(out.a?.status).toBe('stale');
  });

  it('leaves error and missing values untouched', () => {
    const persisted: Record<string, StoredValue> = {
      e: { value: undefined, status: 'error', failureKind: 'script-error' },
      m: { value: undefined, status: 'missing' },
    };
    const out = staleValuesForRehydration(persisted);
    expect(out.e?.status).toBe('error');
    expect(out.m?.status).toBe('missing');
  });

  it('does not mutate the input', () => {
    const persisted: Record<string, StoredValue> = {
      a: { value: 1, status: 'fresh' },
    };
    staleValuesForRehydration(persisted);
    expect(persisted.a?.status).toBe('fresh');
  });

  it('preserves other fields (value, ranAt)', () => {
    const out = staleValuesForRehydration({
      a: { value: { n: 3 }, status: 'fresh', ranAt: 123 },
    });
    expect(out.a).toEqual({ value: { n: 3 }, status: 'stale', ranAt: 123 });
  });
});
