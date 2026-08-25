import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { relativePackEntries, resolvePackPaths } from './resolve-pack-paths.js';

const WORKSPACE_ROOT = path.sep === '\\' ? 'C:\\workspace' : '/workspace';
const HOME = path.sep === '\\' ? 'C:\\Users\\ana' : '/home/ana';

describe('resolvePackPaths', () => {
  it('resolves a relative entry against the workspace root', () => {
    const [resolved] = resolvePackPaths(['packs/demo'], WORKSPACE_ROOT);
    expect(resolved).toBe(path.join(WORKSPACE_ROOT, 'packs/demo'));
  });

  it('passes an absolute entry through unchanged', () => {
    const absolute =
      path.sep === '\\' ? 'D:\\elsewhere\\demo' : '/elsewhere/demo';
    const [resolved] = resolvePackPaths([absolute], WORKSPACE_ROOT);
    expect(resolved).toBe(absolute);
  });

  it('resolves a traversal/escape attempt against the workspace root rather than rejecting it', () => {
    // A relative entry is a user-authored trust decision in their OWN
    // settings (application-scope only, per package.json — never settable
    // from a workspace's checked-in .vscode/settings.json), not
    // content-derived, so it is not path-jailed the way a bundle path is.
    // `..` resolves normally and can point outside the workspace root, the
    // same way it would for `path.join` anywhere else.
    const [resolved] = resolvePackPaths(['../outside/demo'], WORKSPACE_ROOT);
    expect(resolved).toBe(path.join(WORKSPACE_ROOT, '../outside/demo'));
    expect(resolved).not.toContain(WORKSPACE_ROOT + path.sep + '..');
  });

  it('leaves a relative entry unresolved when no workspace root is open', () => {
    const [resolved] = resolvePackPaths(['packs/demo'], undefined);
    expect(resolved).toBe('packs/demo');
  });

  it('resolves multiple entries independently, preserving order', () => {
    const absolute =
      path.sep === '\\' ? 'D:\\elsewhere\\demo' : '/elsewhere/demo';
    const resolved = resolvePackPaths(['a', absolute, 'b/c'], WORKSPACE_ROOT);
    expect(resolved).toEqual([
      path.join(WORKSPACE_ROOT, 'a'),
      absolute,
      path.join(WORKSPACE_ROOT, 'b/c'),
    ]);
  });

  it('never throws for an empty list', () => {
    expect(resolvePackPaths([], WORKSPACE_ROOT)).toEqual([]);
  });
});

describe('resolvePackPaths — ITEM 4: ~ expansion', () => {
  it('expands a bare "~" to the home directory', () => {
    const [resolved] = resolvePackPaths(['~'], WORKSPACE_ROOT, HOME);
    expect(resolved).toBe(HOME);
  });

  it('expands "~/..." against the home directory', () => {
    const [resolved] = resolvePackPaths(['~/packs/ana'], WORKSPACE_ROOT, HOME);
    expect(resolved).toBe(path.join(HOME, 'packs/ana'));
  });

  it('an expanded ~ entry is absolute, so it is never re-joined against the workspace root', () => {
    const [resolved] = resolvePackPaths(['~/packs/ana'], WORKSPACE_ROOT, HOME);
    expect(resolved?.startsWith(WORKSPACE_ROOT)).toBe(false);
  });

  it('leaves a ~ entry unexpanded when no home directory is available', () => {
    const [resolved] = resolvePackPaths(
      ['~/packs/ana'],
      WORKSPACE_ROOT,
      undefined,
    );
    expect(resolved).toBe(path.join(WORKSPACE_ROOT, '~/packs/ana'));
  });

  it('does not expand a tilde that is not a leading ~/ or bare ~', () => {
    const [resolved] = resolvePackPaths(['packs/~ana'], WORKSPACE_ROOT, HOME);
    expect(resolved).toBe(path.join(WORKSPACE_ROOT, 'packs/~ana'));
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
