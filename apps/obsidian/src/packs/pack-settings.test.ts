import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACK_SETTINGS,
  MAX_PACK_FOLDERS,
  appendPackFolder,
  normalizePackSettings,
  removePackFolder,
} from './pack-settings.js';

describe('normalizePackSettings', () => {
  it('defaults on non-object input', () => {
    expect(normalizePackSettings(undefined)).toEqual(DEFAULT_PACK_SETTINGS);
    expect(normalizePackSettings(null)).toEqual(DEFAULT_PACK_SETTINGS);
    expect(normalizePackSettings('nope')).toEqual(DEFAULT_PACK_SETTINGS);
  });

  it('defaults when packFolders is missing or not an array', () => {
    expect(normalizePackSettings({})).toEqual(DEFAULT_PACK_SETTINGS);
    expect(normalizePackSettings({ packFolders: 'nope' })).toEqual(
      DEFAULT_PACK_SETTINGS,
    );
  });

  it('keeps well-formed string entries, trimmed', () => {
    const result = normalizePackSettings({
      packFolders: [' /a/b ', '/c/d'],
    });
    expect(result.packFolders).toEqual(['/a/b', '/c/d']);
  });

  it('drops non-string, empty, and whitespace-only entries', () => {
    const result = normalizePackSettings({
      packFolders: ['/a', 42, null, '   ', '/b'],
    });
    expect(result.packFolders).toEqual(['/a', '/b']);
  });

  it('de-duplicates, first occurrence wins', () => {
    const result = normalizePackSettings({
      packFolders: ['/a', '/b', '/a'],
    });
    expect(result.packFolders).toEqual(['/a', '/b']);
  });

  it('caps at MAX_PACK_FOLDERS', () => {
    const many = Array.from(
      { length: MAX_PACK_FOLDERS + 10 },
      (_, i) => `/p${String(i)}`,
    );
    const result = normalizePackSettings({ packFolders: many });
    expect(result.packFolders).toHaveLength(MAX_PACK_FOLDERS);
  });
});

describe('appendPackFolder', () => {
  it('appends a new folder', () => {
    expect(appendPackFolder(['/a'], '/b')).toEqual(['/a', '/b']);
  });

  it('returns undefined for a duplicate', () => {
    expect(appendPackFolder(['/a'], '/a')).toBeUndefined();
  });

  it('returns undefined for an empty/whitespace entry', () => {
    expect(appendPackFolder(['/a'], '   ')).toBeUndefined();
  });

  it('returns undefined once at the cap', () => {
    const atCap = Array.from(
      { length: MAX_PACK_FOLDERS },
      (_, i) => `/p${String(i)}`,
    );
    expect(appendPackFolder(atCap, '/new')).toBeUndefined();
  });
});

describe('removePackFolder', () => {
  it('removes an existing folder', () => {
    expect(removePackFolder(['/a', '/b'], '/a')).toEqual(['/b']);
  });

  it('returns undefined when the folder is not present', () => {
    expect(removePackFolder(['/a'], '/nope')).toBeUndefined();
  });
});
