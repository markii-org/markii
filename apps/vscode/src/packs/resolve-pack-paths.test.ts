import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { resolvePackPaths } from './resolve-pack-paths.js';

const WORKSPACE_ROOT = path.sep === '\\' ? 'C:\\workspace' : '/workspace';

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
