import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { BundleZipError } from './errors';
import { exportZipBundle, openZipBundle } from './zip';

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Finds the first occurrence of `needle` inside `haystack`, or -1. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

describe('openZipBundle — happy path', () => {
  it('reads back files from a well-formed zip', async () => {
    const bytes = zipSync({
      'note.mk.md': u8('# hello'),
      'assets/photo.png': u8('binary-ish'),
      '.cache/data.json': u8('{}'),
    });
    const storage = openZipBundle(bytes);
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

  it('skips directory entries', async () => {
    const bytes = zipSync({
      'assets/': new Uint8Array(0),
      'assets/x.png': u8('x'),
    });
    const storage = openZipBundle(bytes);
    expect(await storage.list()).toEqual(['assets/x.png']);
  });

  it('size() returns the decompressed byte length, or undefined when missing', async () => {
    const bytes = zipSync({ 'note.mk.md': u8('# hello') });
    const storage = openZipBundle(bytes);
    expect(await storage.size('note.mk.md')).toBe(u8('# hello').length);
    expect(await storage.size('nope.txt')).toBeUndefined();
  });

  it('size() throws BundlePathError for a traversal path, same as read()', () => {
    const bytes = zipSync({ 'note.mk.md': u8('# hello') });
    const storage = openZipBundle(bytes);
    // Matches read()/write()/exists() on this storage form: the path-jail
    // check runs synchronously inside the (non-`async`) function body, so
    // it throws immediately rather than rejecting a returned promise.
    expect(() => storage.size('../evil.txt')).toThrow();
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
      'note.mk.md': u8('# hello'),
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
      'note.mk.md': u8('# roundtrip\n\nsome *markdown*.'),
      'assets/photo.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]),
      '.cache/data.json': u8(JSON.stringify({ n: 42 })),
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

describe('openZipBundle — DEFECT 4: decompression-bomb guard', () => {
  it('rejects a high-ratio entry once it exceeds a configured total-bytes budget', () => {
    // 2MB of zeros compresses to a tiny fraction of that; declared against
    // a deliberately small 1MB budget (fast/deterministic for CI — the
    // production default is 256MB, see DEFAULT_MAX_ZIP_TOTAL_BYTES).
    const huge = new Uint8Array(2 * 1024 * 1024); // already zero-filled
    const bytes = zipSync({ '.cache/bomb.bin': huge }, { level: 9 });
    expect(bytes.length).toBeLessThan(64 * 1024); // confirms a real high ratio

    expect(() => openZipBundle(bytes, { maxTotalBytes: 1024 * 1024 })).toThrow(
      BundleZipError,
    );
  });

  it('rejects a single entry that exceeds a configured per-entry budget, even under the total budget', () => {
    const huge = new Uint8Array(2 * 1024 * 1024);
    const bytes = zipSync({ '.cache/bomb.bin': huge }, { level: 9 });

    expect(() =>
      openZipBundle(bytes, {
        maxEntryBytes: 1024 * 1024,
        maxTotalBytes: 1024 * 1024 * 1024,
      }),
    ).toThrow(BundleZipError);
  });

  it('does not reject a well-formed archive that stays under the budget', async () => {
    const bytes = zipSync({ 'note.mk.md': u8('# fine') });
    const storage = openZipBundle(bytes, {
      maxEntryBytes: 1024,
      maxTotalBytes: 1024,
    });
    expect(await storage.read('note.mk.md')).toEqual(u8('# fine'));
  });

  it('never allocates a decompression buffer for the offending entry (typed error, not an OOM)', () => {
    // A second, larger entry after the offending one must never be reached
    // either — the guard fires before inflation of the oversized entry.
    const huge = new Uint8Array(4 * 1024 * 1024);
    const bytes = zipSync(
      { '.cache/bomb.bin': huge, 'note.mk.md': u8('# after the bomb') },
      { level: 9 },
    );
    let threw: unknown;
    try {
      openZipBundle(bytes, { maxTotalBytes: 1024 });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(BundleZipError);
  });
});

describe('openZipBundle — DEFECT 5: colliding entry names', () => {
  it('rejects manifest.json + ./manifest.json (same normalized path)', () => {
    const bytes = zipSync({
      'manifest.json': u8('{"spec":"0.1.0"}'),
      './manifest.json': u8(
        '{"spec":"9.9.9","permissions":{"bundle":["read","write:.cache/"]}}',
      ),
    });
    expect(() => openZipBundle(bytes)).toThrow(BundleZipError);
  });

  it('rejects .cache/x + .cache//x (same normalized path)', () => {
    const bytes = zipSync({
      '.cache/x': u8('benign'),
      '.cache//x': u8('hostile'),
    });
    expect(() => openZipBundle(bytes)).toThrow(BundleZipError);
  });

  it('does not reject distinct entries that normalize to distinct paths', async () => {
    const bytes = zipSync({
      '.cache/x': u8('one'),
      '.cache/y': u8('two'),
    });
    const storage = openZipBundle(bytes);
    expect(await storage.list()).toEqual(['.cache/x', '.cache/y']);
  });
});

describe('openZipBundle — DEFECT 6: CRC-32 verification', () => {
  it('accepts a well-formed archive whose CRC matches', async () => {
    const bytes = zipSync({ 'note.mk.md': u8('# hello, crc-checked world') });
    const storage = openZipBundle(bytes);
    expect(await storage.read('note.mk.md')).toEqual(
      u8('# hello, crc-checked world'),
    );
  });

  it('rejects an entry whose payload was corrupted after compression', () => {
    // level: 0 (store, uncompressed) so a single flipped byte in the
    // payload deterministically changes the decompressed content without
    // risking an unrelated DEFLATE-stream decode failure.
    const original = u8(
      '# this stored payload is long enough to safely flip a byte in the middle of it',
    );
    const bytes = zipSync({ 'note.mk.md': original }, { level: 0 });

    const nameBytes = u8('note.mk.md');
    const nameOffset = indexOfBytes(bytes, nameBytes);
    expect(nameOffset).toBeGreaterThan(-1);
    const dataStart = nameOffset + nameBytes.length;

    const corrupted = bytes.slice();
    corrupted[dataStart + 10] = (corrupted[dataStart + 10]! ^ 0xff) & 0xff;

    expect(() => openZipBundle(corrupted)).toThrow(BundleZipError);
  });
});

describe('openZipBundle — DEFECT 7: prototype-pollution-safe names', () => {
  it('safely round-trips a file whose basename is literally __proto__ (nested, not top-level)', async () => {
    const bytes = zipSync({
      '.cache/__proto__': u8('not a prototype, just a filename'),
      'note.mk.md': u8('# hi'),
    });
    const storage = openZipBundle(bytes);
    expect(await storage.list()).toEqual(['.cache/__proto__', 'note.mk.md']);
    expect(await storage.read('.cache/__proto__')).toEqual(
      u8('not a prototype, just a filename'),
    );
    expect(await storage.read('note.mk.md')).toEqual(u8('# hi'));

    // Object.prototype itself must be completely unaffected.
    expect(Object.prototype.hasOwnProperty.call({}, 'oops')).toBe(false);
  });

  it('exportZipBundle throws a typed error for a top-level __proto__ path instead of corrupting the archive', async () => {
    // fflate's own zip writer cannot represent a *top-level* `__proto__`
    // entry (verified: it throws a raw TypeError from inside zipSync) —
    // exportZipBundle must turn that into a clear BundleZipError, not let
    // the archive silently drop the real file or leak a raw internal error.
    const map = new Map<string, Uint8Array>([
      ['__proto__', u8('top-level, unrepresentable')],
      ['note.mk.md', u8('# hi')],
    ]);
    const storage = {
      read: (path: string) => Promise.resolve(map.get(path)),
      write: (path: string, data: Uint8Array) => {
        map.set(path, data);
        return Promise.resolve();
      },
      list: () => Promise.resolve(Array.from(map.keys()).sort()),
      exists: (path: string) => Promise.resolve(map.has(path)),
      size: (path: string) => Promise.resolve(map.get(path)?.length),
    };
    await expect(exportZipBundle(storage)).rejects.toThrow(BundleZipError);
  });
});

describe('openZipBundle — DEFECT 8: directory-entry validation ordering', () => {
  it('rejects a malformed directory entry (../evil/) loudly instead of silently skipping it', () => {
    const bytes = zipSync({
      'note.mk.md': u8('# hi'),
      '../evil/': new Uint8Array(0),
    });
    try {
      openZipBundle(bytes);
      throw new Error('expected openZipBundle to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BundleZipError);
      const zipErr = err as BundleZipError;
      expect(zipErr.entries).toContain('../evil/');
    }
  });

  it('rejects a bare "/" entry instead of silently opening an empty bundle', () => {
    const bytes = zipSync({ '/': new Uint8Array(0) });
    expect(() => openZipBundle(bytes)).toThrow(BundleZipError);
  });

  it('still accepts a well-formed directory entry (unchanged happy path)', async () => {
    const bytes = zipSync({
      'assets/': new Uint8Array(0),
      'assets/x.png': u8('x'),
    });
    const storage = openZipBundle(bytes);
    expect(await storage.list()).toEqual(['assets/x.png']);
  });
});
