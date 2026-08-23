import { describe, expect, it } from 'vitest';
import {
  dataStateClassName,
  failureKindClass,
  failurePhrase,
  failureTitle,
} from './failure-presentation.js';

describe('failurePhrase', () => {
  it('returns the short phrase for each taxonomy member', () => {
    expect(failurePhrase('script-error')).toBe('script error');
    expect(failurePhrase('capability-denied')).toBe('needs permission');
    expect(failurePhrase('tier-blocked')).toBe('requires manual run');
    expect(failurePhrase('limit')).toBe('limit exceeded');
  });

  it('returns undefined for an absent or out-of-taxonomy kind', () => {
    expect(failurePhrase(undefined)).toBeUndefined();
    // @ts-expect-error deliberately out of taxonomy
    expect(failurePhrase('__proto__')).toBeUndefined();
  });
});

describe('failureTitle', () => {
  it('combines the phrase and the error message', () => {
    expect(failureTitle('boom', 'script-error')).toBe('script error: boom');
  });

  it('falls back to the raw error with no recognized kind', () => {
    expect(failureTitle('boom', undefined)).toBe('boom');
  });

  it('is undefined with neither an error nor a kind', () => {
    expect(failureTitle(undefined, undefined)).toBeUndefined();
  });

  it('is just the phrase with a kind but no error message', () => {
    expect(failureTitle(undefined, 'limit')).toBe('limit exceeded');
  });
});

describe('failureKindClass', () => {
  it('builds the BEM-ish modifier class', () => {
    expect(failureKindClass('mk-stat', 'tier-blocked')).toBe(
      'mk-stat--tier-blocked',
    );
  });

  it('is undefined for an absent kind', () => {
    expect(failureKindClass('mk-stat', undefined)).toBeUndefined();
  });
});

describe('dataStateClassName', () => {
  it('is just the base with no status/kind', () => {
    expect(dataStateClassName('mk-stat', undefined, undefined)).toBe('mk-stat');
  });

  it('appends --stale for a stale status', () => {
    expect(dataStateClassName('mk-stat', 'stale', undefined)).toBe(
      'mk-stat mk-stat--stale',
    );
  });

  it('appends the failure-kind class for an error status', () => {
    expect(dataStateClassName('mk-stat', 'error', 'capability-denied')).toBe(
      'mk-stat mk-stat--capability-denied',
    );
  });

  it('keeps extra state modifiers adjacent to the base, before status/failure hooks', () => {
    expect(
      dataStateClassName('mk-chart', 'stale', 'limit', ['mk-chart--empty']),
    ).toBe('mk-chart mk-chart--empty mk-chart--stale mk-chart--limit');
  });
});
