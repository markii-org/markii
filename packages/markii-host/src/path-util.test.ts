import * as nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { dirnamePath, isAbsolutePath, joinPath } from './path-util';

describe('joinPath', () => {
  it('joins posix paths and collapses dots like path.posix.join', () => {
    const cases: [string, string[]][] = [
      ['/a/b', ['c']],
      ['/a/b/', ['c', 'd.json']],
      ['/a/b', ['../c']],
      ['/a/b', ['./c//d']],
      ['a/b', ['..', '..', '..', 'c']],
      ['/', ['a']],
      ['', ['a']],
      ['.', ['a']],
    ];
    for (const [base, parts] of cases) {
      expect(joinPath(base, ...parts), `${base} ${parts}`).toBe(
        nodePath.posix.join(base, ...parts),
      );
    }
  });

  it('joins windows paths with backslashes like path.win32.join', () => {
    const cases: [string, string[]][] = [
      ['C:\\Users\\ana', ['packs', 'demo']],
      ['C:\\Users\\ana\\', ['packs']],
      ['C:\\Users\\ana', ['a/b']],
      ['C:\\Users\\ana', ['..', 'bob']],
      ['C:\\', ['x']],
      ['\\\\server\\share\\dir', ['x']],
    ];
    for (const [base, parts] of cases) {
      expect(joinPath(base, ...parts), `${base} ${parts}`).toBe(
        nodePath.win32.join(base, ...parts),
      );
    }
  });

  it('keeps a Windows drive path from gaining a forward slash', () => {
    expect(joinPath('C:\\Users\\ana\\packs', 'demo', 'pack.json')).toBe(
      'C:\\Users\\ana\\packs\\demo\\pack.json',
    );
  });
});

describe('dirnamePath', () => {
  it('matches path.dirname for posix and windows paths', () => {
    expect(dirnamePath('/a/b/c.js')).toBe(nodePath.posix.dirname('/a/b/c.js'));
    expect(dirnamePath('/a')).toBe('/');
    expect(dirnamePath('C:\\a\\b\\c.js')).toBe(
      nodePath.win32.dirname('C:\\a\\b\\c.js'),
    );
    expect(dirnamePath('a/b')).toBe('a');
    expect(dirnamePath('a')).toBe('.');
  });
});

describe('isAbsolutePath', () => {
  it('recognises posix, drive, and UNC roots', () => {
    for (const p of ['/a', 'C:\\a', 'c:/a', '\\\\srv\\share', '\\a']) {
      expect(isAbsolutePath(p), p).toBe(true);
    }
    for (const p of ['a', './a', '../a', 'a/b', 'C:a', '']) {
      expect(isAbsolutePath(p), p).toBe(false);
    }
  });
});
