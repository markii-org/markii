import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCAL_SETTINGS,
  normalizeLocalSettings,
} from './local-settings.js';

// `MIN_REFRESH_INTERVAL_SECONDS`/`refreshIntervalMsFromSeconds` moved to
// `@markii/host`'s `host/refresh-interval.ts` (batch 11) and are tested
// there. This file keeps only what is genuinely this host's own: the
// `LocalSettings` shape and its hostile-input normalization.

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
    ).toEqual({
      runOnOpen: true,
      refreshIntervalSeconds: 30,
      scriptsDisabled: false,
    });
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
    ).toEqual({
      runOnOpen: false,
      refreshIntervalSeconds: 0,
      scriptsDisabled: false,
    });
  });
});

describe('scriptsDisabled (issue #34)', () => {
  it('defaults to off, so an existing device runs scripts exactly as it did', () => {
    expect(DEFAULT_LOCAL_SETTINGS.scriptsDisabled).toBe(false);
    expect(normalizeLocalSettings({}).scriptsDisabled).toBe(false);
    expect(normalizeLocalSettings(null).scriptsDisabled).toBe(false);
  });

  it('accepts a real boolean and falls back per-field on anything else', () => {
    expect(normalizeLocalSettings({ scriptsDisabled: true })).toEqual({
      ...DEFAULT_LOCAL_SETTINGS,
      scriptsDisabled: true,
    });
    expect(normalizeLocalSettings({ scriptsDisabled: 'yes' })).toEqual(
      DEFAULT_LOCAL_SETTINGS,
    );
    expect(normalizeLocalSettings({ scriptsDisabled: 1 })).toEqual(
      DEFAULT_LOCAL_SETTINGS,
    );
  });

  it('survives a round trip beside the other device-local keys', () => {
    const stored = {
      runOnOpen: true,
      refreshIntervalSeconds: 30,
      scriptsDisabled: true,
    };
    expect(normalizeLocalSettings(stored)).toEqual(stored);
  });
});
