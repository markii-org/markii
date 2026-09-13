import { describe, expect, it } from 'vitest';
import {
  MIN_REFRESH_INTERVAL_SECONDS,
  parseRefreshIntervalSeconds,
  refreshIntervalMsFromSeconds,
  refreshIntervalValidationMessage,
} from './refresh-interval.js';

describe('parseRefreshIntervalSeconds', () => {
  it('parses a positive whole number', () => {
    expect(parseRefreshIntervalSeconds('30')).toBe(30);
    expect(parseRefreshIntervalSeconds('1')).toBe(1);
  });

  it('trims surrounding whitespace', () => {
    expect(parseRefreshIntervalSeconds('  12  ')).toBe(12);
  });

  it('rejects empty input', () => {
    expect(parseRefreshIntervalSeconds('')).toBeUndefined();
    expect(parseRefreshIntervalSeconds('   ')).toBeUndefined();
  });

  it('rejects zero and negative values', () => {
    expect(parseRefreshIntervalSeconds('0')).toBeUndefined();
    expect(parseRefreshIntervalSeconds('-5')).toBeUndefined();
  });

  it('rejects fractional values', () => {
    expect(parseRefreshIntervalSeconds('2.5')).toBeUndefined();
  });

  it('rejects non-numeric input', () => {
    expect(parseRefreshIntervalSeconds('abc')).toBeUndefined();
    expect(parseRefreshIntervalSeconds('30s')).toBeUndefined();
    expect(parseRefreshIntervalSeconds('1e3')).toBeUndefined();
  });
});

describe('refreshIntervalValidationMessage', () => {
  it('returns undefined for valid input', () => {
    expect(refreshIntervalValidationMessage('30')).toBeUndefined();
  });

  it('returns an error message for invalid input', () => {
    expect(refreshIntervalValidationMessage('')).toBeTypeOf('string');
    expect(refreshIntervalValidationMessage('0')).toBeTypeOf('string');
    expect(refreshIntervalValidationMessage('nope')).toBeTypeOf('string');
  });
});

describe('refreshIntervalMsFromSeconds', () => {
  it('is off (undefined) for zero, negative, or non-finite input', () => {
    expect(refreshIntervalMsFromSeconds(0)).toBeUndefined();
    expect(refreshIntervalMsFromSeconds(-1)).toBeUndefined();
    expect(refreshIntervalMsFromSeconds(Number.NaN)).toBeUndefined();
    expect(
      refreshIntervalMsFromSeconds(Number.POSITIVE_INFINITY),
    ).toBeUndefined();
  });

  it('clamps a positive value under the minimum up to it', () => {
    expect(refreshIntervalMsFromSeconds(1)).toBe(
      MIN_REFRESH_INTERVAL_SECONDS * 1000,
    );
    expect(refreshIntervalMsFromSeconds(2)).toBe(
      MIN_REFRESH_INTERVAL_SECONDS * 1000,
    );
  });

  it('passes a value at or above the minimum through unclamped', () => {
    expect(refreshIntervalMsFromSeconds(5)).toBe(5000);
    expect(refreshIntervalMsFromSeconds(60)).toBe(60_000);
  });

  it('accepts, rather than rejects, a positive value below the minimum at the parse stage', () => {
    // The clamp-not-reject policy: a host's settings UI must not silently
    // rewrite what the user typed. `parseRefreshIntervalSeconds` accepts
    // it; only `refreshIntervalMsFromSeconds`, at the point a timer is
    // actually scheduled, clamps it up.
    expect(parseRefreshIntervalSeconds('1')).toBe(1);
    expect(refreshIntervalMsFromSeconds(1)).toBe(
      MIN_REFRESH_INTERVAL_SECONDS * 1000,
    );
  });
});
