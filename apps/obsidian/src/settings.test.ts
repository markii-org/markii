import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js';

describe('normalizeSettings', () => {
  it('returns the defaults for undefined (fresh install, no data.json yet)', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults for null', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults for a non-object value', () => {
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(['array'])).toEqual({
      previewPlacement: 'main',
    });
  });

  it('accepts a valid previewPlacement', () => {
    expect(normalizeSettings({ previewPlacement: 'right-sidebar' })).toEqual({
      previewPlacement: 'right-sidebar',
    });
    expect(normalizeSettings({ previewPlacement: 'main' })).toEqual({
      previewPlacement: 'main',
    });
  });

  it('falls back to the default for an unknown/stale/corrupted previewPlacement', () => {
    expect(normalizeSettings({ previewPlacement: 'left-sidebar' })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(normalizeSettings({ previewPlacement: 123 })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(normalizeSettings({ previewPlacement: null })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('ignores unrelated keys instead of throwing on them', () => {
    expect(
      normalizeSettings({ previewPlacement: 'main', someFutureKey: true }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});
