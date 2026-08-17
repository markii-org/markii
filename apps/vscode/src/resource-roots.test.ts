import { describe, expect, it } from 'vitest';
import {
  isCoveredByRoots,
  isWithinRoot,
  withTrailingSlash,
} from './resource-roots';

describe('withTrailingSlash', () => {
  it('appends a slash when there is none', () => {
    expect(withTrailingSlash('https://host/a/b')).toBe('https://host/a/b/');
  });

  it('leaves an existing trailing slash alone', () => {
    expect(withTrailingSlash('https://host/a/b/')).toBe('https://host/a/b/');
  });

  it('handles the empty string', () => {
    expect(withTrailingSlash('')).toBe('/');
  });

  it('makes relative resolution stay inside the folder', () => {
    // The whole reason this function exists: without the trailing slash,
    // `new URL` treats the last segment as a file name and resolves against
    // the PARENT folder.
    expect(new URL('nice.png', withTrailingSlash('https://h/notes')).href).toBe(
      'https://h/notes/nice.png',
    );
    expect(new URL('nice.png', 'https://h/notes').href).toBe(
      'https://h/nice.png',
    );
  });
});

describe('isWithinRoot', () => {
  it('is true for the root itself', () => {
    expect(isWithinRoot('file:///home/u/notes', 'file:///home/u/notes')).toBe(
      true,
    );
  });

  it('is true for a descendant', () => {
    expect(isWithinRoot('file:///home/u', 'file:///home/u/notes/deeper')).toBe(
      true,
    );
  });

  it('is false for a sibling that merely shares a name prefix', () => {
    expect(isWithinRoot('file:///home/user', 'file:///home/username')).toBe(
      false,
    );
  });

  it('is false for a parent of the root', () => {
    expect(isWithinRoot('file:///home/u/notes', 'file:///home/u')).toBe(false);
  });

  it('ignores a trailing slash on either side', () => {
    expect(isWithinRoot('file:///home/u/', 'file:///home/u')).toBe(true);
    expect(isWithinRoot('file:///home/u', 'file:///home/u/')).toBe(true);
  });

  it('distinguishes schemes and authorities', () => {
    expect(isWithinRoot('file:///home/u', 'vscode-remote:///home/u')).toBe(
      false,
    );
    expect(
      isWithinRoot('vscode-remote://a/home/u', 'vscode-remote://b/home/u'),
    ).toBe(false);
  });

  it('treats an empty root or candidate as no match', () => {
    expect(isWithinRoot('', 'file:///home/u')).toBe(false);
    expect(isWithinRoot('file:///home/u', '')).toBe(false);
    expect(isWithinRoot('', '')).toBe(false);
  });
});

describe('isCoveredByRoots', () => {
  const roots = [
    'file:///ext/dist/webview',
    'file:///home/u/project',
    'file:///home/u/other',
  ];

  it('is true when any root covers the candidate', () => {
    expect(isCoveredByRoots(roots, 'file:///home/u/other/deep')).toBe(true);
  });

  it('is false when no root covers the candidate', () => {
    expect(isCoveredByRoots(roots, 'file:///tmp/scratch')).toBe(false);
  });

  it('is false for an empty root list', () => {
    expect(isCoveredByRoots([], 'file:///home/u/project')).toBe(false);
  });
});
