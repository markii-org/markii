import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { relativePackEntries, resolvePackPaths } from './pack-paths.js';

const BASE_DIR = path.sep === '\\' ? 'C:\\vault' : '/vault';
const HOME = path.sep === '\\' ? 'C:\\Users\\ana' : '/home/ana';

describe('resolvePackPaths', () => {
  it('resolves a relative entry against the base directory', () => {
    const [resolved] = resolvePackPaths(['packs/demo'], BASE_DIR);
    expect(resolved).toBe(path.join(BASE_DIR, 'packs/demo'));
  });

  it('passes an absolute entry through unchanged', () => {
    const absolute =
      path.sep === '\\' ? 'D:\\elsewhere\\demo' : '/elsewhere/demo';
    const [resolved] = resolvePackPaths([absolute], BASE_DIR);
    expect(resolved).toBe(absolute);
  });

  it('resolves a traversal/escape attempt against the base directory rather than rejecting it', () => {
    // A relative entry is a user-authored trust decision in their OWN
    // pack-folder setting, not content-derived, so it is not path-jailed
    // the way a bundle path is.
    const [resolved] = resolvePackPaths(['../outside/demo'], BASE_DIR);
    expect(resolved).toBe(path.join(BASE_DIR, '../outside/demo'));
    expect(resolved).not.toContain(BASE_DIR + path.sep + '..');
  });

  it('leaves a relative entry unresolved when no base directory is available', () => {
    const [resolved] = resolvePackPaths(['packs/demo'], undefined);
    expect(resolved).toBe('packs/demo');
  });

  it('resolves multiple entries independently, preserving order', () => {
    const absolute =
      path.sep === '\\' ? 'D:\\elsewhere\\demo' : '/elsewhere/demo';
    const resolved = resolvePackPaths(['a', absolute, 'b/c'], BASE_DIR);
    expect(resolved).toEqual([
      path.join(BASE_DIR, 'a'),
      absolute,
      path.join(BASE_DIR, 'b/c'),
    ]);
  });

  it('never throws for an empty list', () => {
    expect(resolvePackPaths([], BASE_DIR)).toEqual([]);
  });
});

describe('resolvePackPaths — ~ expansion', () => {
  it('expands a bare "~" to the home directory', () => {
    const [resolved] = resolvePackPaths(['~'], BASE_DIR, HOME);
    expect(resolved).toBe(HOME);
  });

  it('expands "~/..." against the home directory', () => {
    const [resolved] = resolvePackPaths(['~/packs/ana'], BASE_DIR, HOME);
    expect(resolved).toBe(path.join(HOME, 'packs/ana'));
  });

  it('an expanded ~ entry is absolute, so it is never re-joined against the base directory', () => {
    const [resolved] = resolvePackPaths(['~/packs/ana'], BASE_DIR, HOME);
    expect(resolved?.startsWith(BASE_DIR)).toBe(false);
  });

  it('leaves a ~ entry unexpanded when no home directory is available', () => {
    const [resolved] = resolvePackPaths(['~/packs/ana'], BASE_DIR, undefined);
    expect(resolved).toBe(path.join(BASE_DIR, '~/packs/ana'));
  });

  it('does not expand a tilde that is not a leading ~/ or bare ~', () => {
    const [resolved] = resolvePackPaths(['packs/~ana'], BASE_DIR, HOME);
    expect(resolved).toBe(path.join(BASE_DIR, 'packs/~ana'));
  });
});

describe('relativePackEntries', () => {
  it('flags a plain relative entry', () => {
    expect(relativePackEntries(['packs/demo'], HOME)).toEqual(['packs/demo']);
  });

  it('does not flag an already-absolute entry', () => {
    const absolute =
      path.sep === '\\' ? 'D:\\elsewhere\\demo' : '/elsewhere/demo';
    expect(relativePackEntries([absolute], HOME)).toEqual([]);
  });

  it('does not flag a ~-prefixed entry (it resolves to an absolute path)', () => {
    expect(relativePackEntries(['~/packs/ana', '~'], HOME)).toEqual([]);
  });

  it('flags a ~-prefixed entry when there is no home directory to expand it against', () => {
    expect(relativePackEntries(['~/packs/ana'], undefined)).toEqual([
      '~/packs/ana',
    ]);
  });

  it('preserves the original (unexpanded) entry text for a flagged relative entry', () => {
    expect(relativePackEntries(['../shared/packs'], HOME)).toEqual([
      '../shared/packs',
    ]);
  });

  it('returns entries in order, mixing flagged and unflagged', () => {
    const absolute =
      path.sep === '\\' ? 'D:\\elsewhere\\demo' : '/elsewhere/demo';
    expect(relativePackEntries(['a', absolute, '~/b', 'c'], HOME)).toEqual([
      'a',
      'c',
    ]);
  });
});
