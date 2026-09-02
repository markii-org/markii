import { describe, expect, it } from 'vitest';
import { createSnapshotStorage } from './snapshot-storage';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('createSnapshotStorage', () => {
  it('reads back exactly what it was seeded with', async () => {
    const storage = createSnapshotStorage({
      '.cache/a.json': bytesOf('{"x":1}'),
    });
    expect(await storage.exists('.cache/a.json')).toBe(true);
    expect(new TextDecoder().decode(await storage.read('.cache/a.json'))).toBe(
      '{"x":1}',
    );
    expect(await storage.read('.cache/missing.json')).toBeUndefined();
    expect(await storage.exists('.cache/missing.json')).toBe(false);
  });

  it('write is visible to a later read/exists/list on the same storage', async () => {
    const storage = createSnapshotStorage({});
    await storage.write('.cache/new.json', bytesOf('hi'));
    expect(await storage.exists('.cache/new.json')).toBe(true);
    expect(
      new TextDecoder().decode(await storage.read('.cache/new.json')),
    ).toBe('hi');
    expect(await storage.list()).toEqual(['.cache/new.json']);
  });

  it('never mutates the caller-supplied initial file map', async () => {
    const initial = { '.cache/a.json': bytesOf('original') };
    const storage = createSnapshotStorage(initial);
    await storage.write('.cache/a.json', bytesOf('changed'));
    expect(new TextDecoder().decode(initial['.cache/a.json'])).toBe('original');
  });

  it('currentFiles() reflects every write performed so far', async () => {
    const storage = createSnapshotStorage({ '.cache/a.json': bytesOf('a') });
    await storage.write('.cache/b.json', bytesOf('b'));
    const files = storage.currentFiles();
    expect(Object.keys(files).sort()).toEqual([
      '.cache/a.json',
      '.cache/b.json',
    ]);
    expect(new TextDecoder().decode(files['.cache/b.json'])).toBe('b');
  });

  it('rejects a path-jail escape on read/write/exists/size, same as any other BundleStorage', async () => {
    const storage = createSnapshotStorage({});
    await expect(storage.read('../escape.json')).rejects.toThrow();
    await expect(
      storage.write('../escape.json', bytesOf('x')),
    ).rejects.toThrow();
    await expect(storage.exists('../escape.json')).rejects.toThrow();
    await expect(storage.size('../escape.json')).rejects.toThrow();
  });

  it('size() returns the byte length, or undefined when missing', async () => {
    const storage = createSnapshotStorage({
      '.cache/a.json': bytesOf('{"x":1}'),
    });
    expect(await storage.size('.cache/a.json')).toBe(bytesOf('{"x":1}').length);
    expect(await storage.size('.cache/missing.json')).toBeUndefined();
  });

  it('list() returns paths sorted', async () => {
    const storage = createSnapshotStorage({
      '.cache/z.json': bytesOf('z'),
      '.cache/a.json': bytesOf('a'),
    });
    expect(await storage.list()).toEqual(['.cache/a.json', '.cache/z.json']);
  });
});
