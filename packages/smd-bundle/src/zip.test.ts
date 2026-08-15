import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { BundleZipError } from './errors';
import { exportZipBundle, openZipBundle } from './zip';

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('openZipBundle — happy path', () => {
  it('reads back files from a well-formed zip', async () => {
    const bytes = zipSync({
      'note.smd': u8('# hello'),
      'assets/photo.png': u8('binary-ish'),
      'cache/data.json': u8('{}'),
    });
    const storage = openZipBundle(bytes);
    expect(await storage.list()).toEqual([
      'assets/photo.png',
      'cache/data.json',
      'note.smd',
    ]);
    expect(await storage.read('note.smd')).toEqual(u8('# hello'));
    expect(await storage.exists('assets/photo.png')).toBe(true);
    expect(await storage.exists('nope.txt')).toBe(false);
    expect(await storage.read('nope.txt')).toBeUndefined();
  });

  it('skips directory entries', async () => {
    const bytes = zipSync({
      'assets/': new Uint8Array(0),
      'assets/x.png': u8('x'),
    });
    const storage = openZipBundle(bytes);
    expect(await storage.list()).toEqual(['assets/x.png']);
  });
});

describe('openZipBundle — zip-slip rejection', () => {
  it('rejects an entry with a ../ traversal name', () => {
    const bytes = zipSync({ '../evil.txt': u8('pwned') });
    expect(() => openZipBundle(bytes)).toThrow(BundleZipError);
  });

  it('lists the offending entry name on the thrown error', () => {
    const bytes = zipSync({ '../evil.txt': u8('pwned') });
    try {
      openZipBundle(bytes);
      throw new Error('expected openZipBundle to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BundleZipError);
      const zipErr = err as BundleZipError;
      expect(zipErr.entries).toContain('../evil.txt');
    }
  });

  it('rejects an absolute-path entry', () => {
    const bytes = zipSync({ '/etc/passwd': u8('pwned') });
    expect(() => openZipBundle(bytes)).toThrow(BundleZipError);
  });

  it('rejects a backslash-path entry', () => {
    const bytes = zipSync({ 'a\\..\\..\\evil.txt': u8('pwned') });
    expect(() => openZipBundle(bytes)).toThrow(BundleZipError);
  });

  it('rejects a drive-letter entry', () => {
    const bytes = zipSync({ 'C:/evil.txt': u8('pwned') });
    expect(() => openZipBundle(bytes)).toThrow(BundleZipError);
  });

  it('rejects the whole archive (not just the bad entry) when mixed with safe entries', () => {
    const bytes = zipSync({
      'note.smd': u8('# hello'),
      '../evil.txt': u8('pwned'),
    });
    expect(() => openZipBundle(bytes)).toThrow(BundleZipError);
  });

  it('reports every offending entry when multiple are present', () => {
    const bytes = zipSync({
      '../evil-1.txt': u8('a'),
      '/evil-2.txt': u8('b'),
      'fine.txt': u8('c'),
    });
    try {
      openZipBundle(bytes);
      throw new Error('expected openZipBundle to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BundleZipError);
      const zipErr = err as BundleZipError;
      expect([...zipErr.entries].sort()).toEqual([
        '../evil-1.txt',
        '/evil-2.txt',
      ]);
    }
  });
});

describe('map <-> zip round-trip', () => {
  it('produces byte-identical file contents after zip -> storage -> zip -> storage', async () => {
    const files = {
      'note.smd': u8('# roundtrip\n\nsome *markdown*.'),
      'assets/photo.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]),
      'cache/data.json': u8(JSON.stringify({ n: 42 })),
    };
    const bytes1 = zipSync(files);
    const storage1 = openZipBundle(bytes1);
    const bytes2 = await exportZipBundle(storage1);
    const storage2 = openZipBundle(bytes2);

    expect(await storage2.list()).toEqual(await storage1.list());
    for (const path of await storage1.list()) {
      expect(await storage2.read(path)).toEqual(await storage1.read(path));
    }
  });
});
