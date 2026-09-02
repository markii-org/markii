import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  HIDE_SCRIPT_BLOCKS_CLASS,
  PREVIEW_WIDTH_CLASSES,
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
      hideScriptBlocks: false,
      inlineReadingView: true,
    });
  });

  it('accepts a valid previewPlacement', () => {
    expect(normalizeSettings({ previewPlacement: 'right-sidebar' })).toEqual({
      previewPlacement: 'right-sidebar',
      previewWidth: 'normal',
      hideScriptBlocks: false,
      inlineReadingView: true,
    });
    expect(normalizeSettings({ previewPlacement: 'main' })).toEqual({
      previewPlacement: 'main',
      previewWidth: 'normal',
      hideScriptBlocks: false,
      inlineReadingView: true,
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
        hideScriptBlocks: false,
        inlineReadingView: true,
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

describe('hideScriptBlocks (issue #34)', () => {
  it('defaults to off, so an existing vault renders exactly as it did', () => {
    expect(DEFAULT_SETTINGS.hideScriptBlocks).toBe(false);
    expect(normalizeSettings({}).hideScriptBlocks).toBe(false);
  });

  it('accepts a real boolean and falls back per-field on anything else', () => {
    expect(normalizeSettings({ hideScriptBlocks: true })).toEqual({
      previewPlacement: 'main',
      previewWidth: 'normal',
      hideScriptBlocks: true,
      inlineReadingView: true,
    });
    expect(normalizeSettings({ hideScriptBlocks: 'yes' })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(normalizeSettings({ hideScriptBlocks: 1 })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(normalizeSettings({ hideScriptBlocks: null })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('names one class, on the same element the width classes use', () => {
    expect(HIDE_SCRIPT_BLOCKS_CLASS).toBe('mk-obsidian-preview--hide-scripts');
    expect(PREVIEW_WIDTH_CLASSES).not.toContain(HIDE_SCRIPT_BLOCKS_CLASS);
  });

  /**
   * The stylesheet is the whole feature: the renderer is untouched, so if
   * this rule ever stops targeting `.mk-script`, or starts targeting
   * anything else, the setting either does nothing or hides a failure a
   * reader needed to see.
   */
  it('hides the script markers and nothing else', () => {
    const css = readFileSync(
      resolve(import.meta.dirname, 'obsidian-theme.css'),
      'utf8',
    );
    expect(css).toContain(
      `.${HIDE_SCRIPT_BLOCKS_CLASS} .doc .mk-script {\n  display: none;\n}`,
    );
    const selectors = [
      ...css.matchAll(
        new RegExp(`\\.${HIDE_SCRIPT_BLOCKS_CLASS}[^{]*\\{`, 'g'),
      ),
    ].map((match) => match[0]);
    expect(selectors).toHaveLength(1);
  });
});

describe('inlineReadingView', () => {
  it('defaults to on, so Reading view renders components without any setup', () => {
    expect(DEFAULT_SETTINGS.inlineReadingView).toBe(true);
    expect(normalizeSettings({}).inlineReadingView).toBe(true);
  });

  it('accepts a real boolean and falls back on anything else', () => {
    expect(normalizeSettings({ inlineReadingView: false })).toEqual({
      previewPlacement: 'main',
      previewWidth: 'normal',
      hideScriptBlocks: false,
      inlineReadingView: false,
    });
    expect(normalizeSettings({ inlineReadingView: 'no' })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(normalizeSettings({ inlineReadingView: 0 })).toEqual(
      DEFAULT_SETTINGS,
    );
    expect(normalizeSettings({ inlineReadingView: null })).toEqual(
      DEFAULT_SETTINGS,
    );
  });
});
