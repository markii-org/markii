import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  previewWidthClassName,
} from './settings.js';

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
      previewWidth: 'normal',
    });
  });

  it('accepts a valid previewPlacement', () => {
    expect(normalizeSettings({ previewPlacement: 'right-sidebar' })).toEqual({
      previewPlacement: 'right-sidebar',
      previewWidth: 'normal',
    });
    expect(normalizeSettings({ previewPlacement: 'main' })).toEqual({
      previewPlacement: 'main',
      previewWidth: 'normal',
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

  it('accepts each valid previewWidth', () => {
    for (const previewWidth of ['normal', 'wide', 'full']) {
      expect(normalizeSettings({ previewWidth })).toEqual({
        previewPlacement: 'main',
        previewWidth,
      });
    }
  });

  it('falls back to the default for an unknown or corrupted previewWidth', () => {
    expect(normalizeSettings({ previewWidth: 'enormous' })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(normalizeSettings({ previewWidth: 64 })).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ previewWidth: null })).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults to the width the preview has always rendered at', () => {
    expect(DEFAULT_SETTINGS.previewWidth).toBe('normal');
    expect(previewWidthClassName('normal')).toBeUndefined();
    expect(previewWidthClassName('wide')).toBe('mk-obsidian-preview--wide');
    expect(previewWidthClassName('full')).toBe('mk-obsidian-preview--full');
  });

  it('ignores unrelated keys instead of throwing on them', () => {
    expect(
      normalizeSettings({ previewPlacement: 'main', someFutureKey: true }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});
