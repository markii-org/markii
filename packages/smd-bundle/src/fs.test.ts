import { zipSync } from 'fflate';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BundlePathError } from './errors';
import { dirToZip, openDirBundle, promoteToBundle, zipToDir } from './fs';

function u8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const tmpDirs: string[] = [];

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe('openDirBundle — happy path', () => {
  it('writes and reads a file', async () => {
    const dir = await makeTmpDir('smd-bundle-fs-');
    const storage = openDirBundle(dir);
    await storage.write('cache/data.json', u8('{"ok":true}'));
    expect(await storage.read('cache/data.json')).toEqual(u8('{"ok":true}'));
    expect(await readFile(join(dir, 'cache', 'data.json'), 'utf8')).toBe(
      '{"ok":true}',
    );
  });

  it('returns undefined for a missing file', async () => {
    const dir = await makeTmpDir('smd-bundle-fs-');
    const storage = openDirBundle(dir);
    expect(await storage.read('nope.txt')).toBeUndefined();
  });

  it('reports exists correctly', async () => {
    const dir = await makeTmpDir('smd-bundle-fs-');
    const storage = openDirBundle(dir);
    await storage.write('assets/a.txt', u8('a'));
    expect(await storage.exists('assets/a.txt')).toBe(true);
    expect(await storage.exists('assets/b.txt')).toBe(false);
  });

  it('lists all files recursively, sorted, bundle-relative', async () => {
    const dir = await makeTmpDir('smd-bundle-fs-');
    const storage = openDirBundle(dir);
    await storage.write('note.smd', u8('# hi'));
    await storage.write('assets/photo.png', u8('img'));
    await storage.write('cache/nested/deep.json', u8('{}'));
    expect(await storage.list()).toEqual([
      'assets/photo.png',
      'cache/nested/deep.json',
      'note.smd',
    ]);
  });

  it('creates missing intermediate directories on write', async () => {
    const dir = await makeTmpDir('smd-bundle-fs-');
    const storage = openDirBundle(dir);
    await storage.write('a/b/c/d.txt', u8('deep'));
    expect(await storage.read('a/b/c/d.txt')).toEqual(u8('deep'));
  });
});

describe('openDirBundle — path-jail enforcement', () => {
  it('throws BundlePathError for a traversal path on write', async () => {
    const dir = await makeTmpDir('smd-bundle-fs-');
    const storage = openDirBundle(dir);
    await expect(storage.write('../evil.txt', u8('x'))).rejects.toThrow(
      BundlePathError,
    );
  });

  it('throws BundlePathError for a traversal path on read', async () => {
    const dir = await makeTmpDir('smd-bundle-fs-');
    const storage = openDirBundle(dir);
    await expect(storage.read('../../etc/passwd')).rejects.toThrow(
      BundlePathError,
    );
  });
});

describe('openDirBundle — symlink escape', () => {
  it('rejects reads/writes through a symlink planted inside the bundle pointing outside it', async ({
    skip,
  }) => {
    const outsideDir = await makeTmpDir('smd-bundle-fs-outside-');
    const secretPath = join(outsideDir, 'secret.txt');
    await writeFile(secretPath, 'outside-the-bundle', 'utf8');

    const bundleDir = await makeTmpDir('smd-bundle-fs-bundle-');
    const linkPath = join(bundleDir, 'escape-link');

    try {
      await symlink(secretPath, linkPath, 'file');
    } catch {
      // Platform/user lacks permission to create symlinks (common in
      // sandboxed CI or on Windows without dev mode) — skip cleanly rather
      // than failing the suite for an environment limitation.
      skip();
      return;
    }

    const storage = openDirBundle(bundleDir);
    await expect(storage.read('escape-link')).rejects.toThrow(BundlePathError);
    await expect(
      storage.write('escape-link', u8('overwritten')),
    ).rejects.toThrow(BundlePathError);

    // The file outside the bundle must be untouched.
    expect(await readFile(secretPath, 'utf8')).toBe('outside-the-bundle');
  });

  it('rejects writes through a symlinked directory inside the bundle', async ({
    skip,
  }) => {
    const outsideDir = await makeTmpDir('smd-bundle-fs-outside-');
    const bundleDir = await makeTmpDir('smd-bundle-fs-bundle-');
    const linkDirPath = join(bundleDir, 'cache');

    try {
      await symlink(outsideDir, linkDirPath, 'dir');
    } catch {
      skip();
      return;
    }

    const storage = openDirBundle(bundleDir);
    await expect(
      storage.write('cache/new-file.json', u8('{}')),
    ).rejects.toThrow(BundlePathError);

    // Nothing should have been written into the outside directory.
    const outsideStorage = openDirBundle(outsideDir);
    expect(await outsideStorage.exists('new-file.json')).toBe(false);
  });
});

describe('promoteToBundle', () => {
  it('scaffolds note.smd and manifest.json', async () => {
    const dir = await makeTmpDir('smd-bundle-fs-');
    const targetDir = join(dir, 'my-note.smdb');
    await promoteToBundle('# My Note\n\nHello.', targetDir, '0.1.0');

    expect(await readFile(join(targetDir, 'note.smd'), 'utf8')).toBe(
      '# My Note\n\nHello.',
    );
    const manifestRaw = await readFile(
      join(targetDir, 'manifest.json'),
      'utf8',
    );
    expect(JSON.parse(manifestRaw)).toEqual({ smd: '0.1.0' });
  });
});

describe('dir <-> zip round-trip', () => {
  it('produces an identical file tree after dir -> zip -> dir', async () => {
    const srcDir = await makeTmpDir('smd-bundle-fs-src-');
    await mkdir(join(srcDir, 'assets'), { recursive: true });
    await mkdir(join(srcDir, 'cache', 'nested'), { recursive: true });
    await writeFile(join(srcDir, 'note.smd'), '# roundtrip\n', 'utf8');
    await writeFile(join(srcDir, 'manifest.json'), '{"smd":"0.1.0"}', 'utf8');
    await writeFile(
      join(srcDir, 'assets', 'photo.png'),
      Buffer.from([1, 2, 3, 4]),
    );
    await writeFile(
      join(srcDir, 'cache', 'nested', 'deep.json'),
      '{"n":1}',
      'utf8',
    );

    const zipBytes = await dirToZip(srcDir);

    const destDir = await makeTmpDir('smd-bundle-fs-dest-');
    await zipToDir(zipBytes, join(destDir, 'extracted'));
    const extractedDir = join(destDir, 'extracted');

    const srcStorage = openDirBundle(srcDir);
    const destStorage = openDirBundle(extractedDir);

    const srcList = await srcStorage.list();
    const destList = await destStorage.list();
    expect(destList).toEqual(srcList);

    for (const path of srcList) {
      expect(await destStorage.read(path)).toEqual(await srcStorage.read(path));
    }
  });

  it('zipToDir rejects a zip-slip archive before writing anything', async () => {
    // A minimal malicious archive: one entry with a `../` traversal name,
    // built with the same fflate primitive `zip.ts` uses. Exercises
    // zipToDir's inherited zip-slip rejection (openZipBundle's own
    // dedicated coverage lives in zip.test.ts).
    const bytes = zipSync({ '../evil.txt': new TextEncoder().encode('pwned') });
    const destDir = await makeTmpDir('smd-bundle-fs-dest-');
    const targetDir = join(destDir, 'extracted');
    await expect(zipToDir(bytes, targetDir)).rejects.toThrow();
  });
});
