import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCAL_SETTINGS,
  MIN_REFRESH_INTERVAL_SECONDS,
  normalizeLocalSettings,
  refreshIntervalMsFromSeconds,
} from './local-settings.js';

describe('normalizeLocalSettings', () => {
  it('returns the defaults for null/non-object input', () => {
    expect(normalizeLocalSettings(null)).toEqual(DEFAULT_LOCAL_SETTINGS);
    expect(normalizeLocalSettings(undefined)).toEqual(DEFAULT_LOCAL_SETTINGS);
    expect(normalizeLocalSettings('nope')).toEqual(DEFAULT_LOCAL_SETTINGS);
    expect(normalizeLocalSettings(42)).toEqual(DEFAULT_LOCAL_SETTINGS);
  });

  it('accepts a well-formed record', () => {
    expect(
      normalizeLocalSettings({ runOnOpen: true, refreshIntervalSeconds: 30 }),
    ).toEqual({ runOnOpen: true, refreshIntervalSeconds: 30 });
  });

  it('falls back per-field on a hostile shape', () => {
    expect(
      normalizeLocalSettings({ runOnOpen: 'yes', refreshIntervalSeconds: -5 }),
    ).toEqual(DEFAULT_LOCAL_SETTINGS);
    expect(
      normalizeLocalSettings({ refreshIntervalSeconds: Number.NaN }),
    ).toEqual(DEFAULT_LOCAL_SETTINGS);
  });

  it('accepts zero (off) explicitly', () => {
    expect(
      normalizeLocalSettings({ runOnOpen: false, refreshIntervalSeconds: 0 }),
    ).toEqual({ runOnOpen: false, refreshIntervalSeconds: 0 });
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
});
