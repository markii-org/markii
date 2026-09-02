import { describe, expect, it } from 'vitest';
import { BundlePathError } from './errors';
import { createMemoryBundleStorage } from './storage';
import { createScriptView } from './script-view';

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('createMemoryBundleStorage — happy path', () => {
  it('starts empty when called with no argument', async () => {
    const storage = createMemoryBundleStorage();
    expect(await storage.list()).toEqual([]);
  });

  it('accepts string content, encoded as UTF-8', async () => {
    const storage = createMemoryBundleStorage({ 'note.mk.md': '# hello' });
    expect(await storage.read('note.mk.md')).toEqual(u8('# hello'));
  });

  it('accepts Uint8Array content unchanged', async () => {
    const bytes = u8('binary-ish');
    const storage = createMemoryBundleStorage({ 'assets/photo.png': bytes });
    expect(await storage.read('assets/photo.png')).toEqual(bytes);
  });

  it('reads back files from a well-formed initial map', async () => {
    const storage = createMemoryBundleStorage({
      'note.mk.md': '# hello',
      'assets/photo.png': u8('binary-ish'),
      '.cache/data.json': '{}',
    });
    expect(await storage.list()).toEqual([
      '.cache/data.json',
      'assets/photo.png',
      'note.mk.md',
    ]);
    expect(await storage.read('note.mk.md')).toEqual(u8('# hello'));
    expect(await storage.exists('assets/photo.png')).toBe(true);
    expect(await storage.exists('nope.txt')).toBe(false);
    expect(await storage.read('nope.txt')).toBeUndefined();
  });

  it('size() returns the byte length without a separate read', async () => {
    const storage = createMemoryBundleStorage({ 'a.txt': 'hello' });
    expect(await storage.size('a.txt')).toBe(u8('hello').length);
    expect(await storage.size('missing.txt')).toBeUndefined();
  });

  it('write() adds a new file, reachable by read() and list()', async () => {
    const storage = createMemoryBundleStorage();
    await storage.write('.cache/out.json', u8('{"ok":true}'));
    expect(await storage.read('.cache/out.json')).toEqual(u8('{"ok":true}'));
    expect(await storage.list()).toEqual(['.cache/out.json']);
  });

  it('write() overwrites an existing entry', async () => {
    const storage = createMemoryBundleStorage({ 'a.txt': 'old' });
    await storage.write('a.txt', u8('new'));
    expect(await storage.read('a.txt')).toEqual(u8('new'));
  });

  it('does not mutate the caller-supplied Uint8Array when read back', async () => {
    const bytes = u8('original');
    const storage = createMemoryBundleStorage({ 'a.bin': bytes });
    const read = await storage.read('a.bin');
    expect(read).toEqual(bytes);
  });
});

describe('createMemoryBundleStorage — path-jail enforcement', () => {
  it('throws BundlePathError for a traversal path in the initial map', () => {
    expect(() => createMemoryBundleStorage({ '../evil.txt': 'x' })).toThrow(
      BundlePathError,
    );
  });

  it('throws BundlePathError for an absolute path in the initial map', () => {
    expect(() => createMemoryBundleStorage({ '/etc/passwd': 'x' })).toThrow(
      BundlePathError,
    );
  });

  it('throws BundlePathError for a traversal path on write()', () => {
    const storage = createMemoryBundleStorage();
    expect(() => storage.write('../evil.txt', u8('x'))).toThrow(
      BundlePathError,
    );
  });

  it('throws BundlePathError for a traversal path on read()', () => {
    const storage = createMemoryBundleStorage();
    expect(() => storage.read('../../etc/passwd')).toThrow(BundlePathError);
  });

  it('throws BundlePathError for a traversal path on size()', () => {
    const storage = createMemoryBundleStorage();
    expect(() => storage.size('../../etc/passwd')).toThrow(BundlePathError);
  });

  it('throws BundlePathError for a traversal path on exists()', () => {
    const storage = createMemoryBundleStorage();
    expect(() => storage.exists('../../etc/passwd')).toThrow(BundlePathError);
  });
});

describe('createMemoryBundleStorage — colliding entry names', () => {
  it('rejects note.mk.md + ./note.mk.md (same normalized path)', () => {
    expect(() =>
      createMemoryBundleStorage({
        'note.mk.md': '# first',
        './note.mk.md': '# second',
      }),
    ).toThrow(BundlePathError);
  });

  it('rejects .cache/x + .cache//x (same normalized path)', () => {
    expect(() =>
      createMemoryBundleStorage({
        '.cache/x': 'benign',
        '.cache//x': 'hostile',
      }),
    ).toThrow(BundlePathError);
  });

  it('does not reject distinct entries that normalize to distinct paths', async () => {
    const storage = createMemoryBundleStorage({
      '.cache/x': 'one',
      '.cache/y': 'two',
    });
    expect(await storage.list()).toEqual(['.cache/x', '.cache/y']);
  });
});

describe('createMemoryBundleStorage — used through a ScriptView', () => {
  it('confines write() to .cache/ once wrapped in createScriptView, exactly like the zip and directory forms', async () => {
    const storage = createMemoryBundleStorage();
    const view = createScriptView(
      storage,
      { spec: '0.1.0', permissions: { bundle: ['read', 'write:.cache/'] } },
      { bundle: ['read', 'write:.cache/'] },
    );

    await view.write('.cache/out.json', u8('{"ok":true}'));
    expect(await storage.read('.cache/out.json')).toEqual(u8('{"ok":true}'));

    await expect(view.write('assets/x.png', u8('nope'))).rejects.toThrow();
    await expect(view.write('manifest.json', u8('nope'))).rejects.toThrow();
  });
});
