import { describe, expect, it, afterEach } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  createFileGrantMemento,
  grantStoreDirectory,
  CLI_STATE_FILE_NAME,
} from './grant-store.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'markii-cli-grant-store-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('grantStoreDirectory', () => {
  it('uses XDG_CONFIG_HOME when set and absolute, on Linux', () => {
    expect(grantStoreDirectory({ XDG_CONFIG_HOME: '/x/config' }, 'linux')).toBe(
      path.join('/x/config', 'markii'),
    );
  });

  it('falls back to ~/.config on Linux when XDG_CONFIG_HOME is unset', () => {
    expect(grantStoreDirectory({ HOME: '/home/al' }, 'linux')).toBe(
      path.join('/home/al', '.config', 'markii'),
    );
  });

  it('ignores a relative XDG_CONFIG_HOME on Linux', () => {
    expect(
      grantStoreDirectory(
        { XDG_CONFIG_HOME: 'relative/path', HOME: '/home/al' },
        'linux',
      ),
    ).toBe(path.join('/home/al', '.config', 'markii'));
  });

  it('uses Application Support on darwin', () => {
    expect(grantStoreDirectory({ HOME: '/Users/al' }, 'darwin')).toBe(
      path.join('/Users/al', 'Library', 'Application Support', 'markii'),
    );
  });

  it('uses APPDATA on win32', () => {
    expect(
      grantStoreDirectory(
        { APPDATA: 'C:\\Users\\al\\AppData\\Roaming' },
        'win32',
      ),
    ).toBe(path.join('C:\\Users\\al\\AppData\\Roaming', 'markii'));
  });

  it('treats an unlisted platform like Linux', () => {
    expect(grantStoreDirectory({ HOME: '/home/al' }, 'freebsd')).toBe(
      path.join('/home/al', '.config', 'markii'),
    );
  });
});

describe('createFileGrantMemento', () => {
  it('reads a missing file as empty', () => {
    const dir = makeTempDir();
    const memento = createFileGrantMemento(path.join(dir, CLI_STATE_FILE_NAME));
    expect(memento.get('anything')).toBeUndefined();
    expect(memento.get('anything', 'fallback')).toBe('fallback');
  });

  it('reads an unreadable (directory-shaped) path as empty', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, CLI_STATE_FILE_NAME);
    // A directory at the exact path a file read would target: readFileSync
    // fails with EISDIR, which must degrade to empty, not throw.
    mkdirSync(filePath, { recursive: true });
    const memento = createFileGrantMemento(filePath);
    expect(memento.get('anything')).toBeUndefined();
  });

  it('reads malformed JSON as empty', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, CLI_STATE_FILE_NAME);
    writeFileSync(filePath, '{not json', 'utf-8');
    const memento = createFileGrantMemento(filePath);
    expect(memento.get('anything')).toBeUndefined();
  });

  it('reads a JSON array top level as empty', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, CLI_STATE_FILE_NAME);
    writeFileSync(filePath, '[1, 2, 3]', 'utf-8');
    const memento = createFileGrantMemento(filePath);
    expect(memento.get('anything')).toBeUndefined();
  });

  it('reads a JSON string top level as empty', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, CLI_STATE_FILE_NAME);
    writeFileSync(filePath, '"hello"', 'utf-8');
    const memento = createFileGrantMemento(filePath);
    expect(memento.get('anything')).toBeUndefined();
  });

  it('reads back a value previously written', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, CLI_STATE_FILE_NAME);
    writeFileSync(
      filePath,
      JSON.stringify({ 'markii.netGrants': { a: 1 } }),
      'utf-8',
    );
    const memento = createFileGrantMemento(filePath);
    expect(memento.get('markii.netGrants')).toEqual({ a: 1 });
  });

  it('is resistant to a __proto__ top-level key', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, CLI_STATE_FILE_NAME);
    writeFileSync(filePath, '{"__proto__": {"polluted": true}}', 'utf-8');
    const memento = createFileGrantMemento(filePath);
    // Neither leaks as a readable grant value nor pollutes Object.prototype.
    expect(memento.get('polluted')).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('writes atomically (no partial file survives) and reads it back', async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, CLI_STATE_FILE_NAME);
    const memento = createFileGrantMemento(filePath);
    await memento.update('key', { hosts: ['example.com'] });

    const onDisk = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(onDisk).toEqual({ key: { hosts: ['example.com'] } });

    // No leftover temporary file.
    const entries = readdirSync(dir);
    expect(entries).toEqual([CLI_STATE_FILE_NAME]);
  });

  it('creates the directory with mode 0o700 and the file with mode 0o600', async () => {
    const dir = makeTempDir();
    const nested = path.join(dir, 'nested');
    const filePath = path.join(nested, CLI_STATE_FILE_NAME);
    const memento = createFileGrantMemento(filePath);
    await memento.update('key', 'value');

    const dirMode = statSync(nested).mode & 0o777;
    const fileMode = statSync(filePath).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it('reflects an update immediately without re-reading the file', async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, CLI_STATE_FILE_NAME);
    const memento = createFileGrantMemento(filePath);
    await memento.update('key', 'first');
    expect(memento.get('key')).toBe('first');
    await memento.update('key', 'second');
    expect(memento.get('key')).toBe('second');
  });

  it('deletes a key when updated with undefined', async () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, CLI_STATE_FILE_NAME);
    const memento = createFileGrantMemento(filePath);
    await memento.update('key', 'value');
    await memento.update('key', undefined);
    expect(memento.get('key')).toBeUndefined();
  });

  it('never throws when the directory cannot be created', async () => {
    // A file (not a directory) at the parent path: mkdir underneath it must
    // fail, and update() must swallow that rather than reject/throw.
    const dir = makeTempDir();
    const blockerPath = path.join(dir, 'blocker');
    writeFileSync(blockerPath, 'not a directory', 'utf-8');
    const filePath = path.join(blockerPath, CLI_STATE_FILE_NAME);
    const memento = createFileGrantMemento(filePath);
    await expect(memento.update('key', 'value')).resolves.toBeUndefined();
  });
});
