import { describe, expect, it } from 'vitest';
import { MAX_EMBEDDED_IMAGE_BYTES } from '@markii/host';
import {
  createVaultImageReader,
  resolveVaultImagePath,
} from './export-images.js';
import type { VaultImageReaderDeps } from './export-images.js';

/** A tiny in-memory vault: paths to bytes, plus a set of paths `getFirstLinkpathDest` resolves. */
function createFakeVault(options: {
  files?: Record<string, Uint8Array>;
  linkTargets?: Record<string, string>;
  statFails?: Set<string>;
  readFails?: Set<string>;
}): VaultImageReaderDeps {
  const files = options.files ?? {};
  const linkTargets = options.linkTargets ?? {};
  const statFails = options.statFails ?? new Set<string>();
  const readFails = options.readFails ?? new Set<string>();

  return {
    linkpathDest: (src) => linkTargets[src],
    pathExists: (path) => Promise.resolve(Object.hasOwn(files, path)),
    statSize: async (path) => {
      if (statFails.has(path)) throw new Error('stat exploded');
      const file = files[path];
      return file ? file.byteLength : undefined;
    },
    readBinary: async (path) => {
      if (readFails.has(path)) throw new Error('read exploded');
      const file = files[path];
      if (!file) throw new Error('no such file');
      return file;
    },
  };
}

describe('resolveVaultImagePath', () => {
  it('prefers the linkpath resolution', async () => {
    const deps = createFakeVault({
      linkTargets: { 'logo.png': 'assets/logo.png' },
    });
    const resolved = await resolveVaultImagePath(
      'logo.png',
      'notes/a.mk.md',
      deps,
    );
    expect(resolved).toBe('assets/logo.png');
  });

  it('falls back to a plain vault-relative path', async () => {
    const deps = createFakeVault({
      files: { 'images/x.png': new Uint8Array([1]) },
    });
    const resolved = await resolveVaultImagePath(
      'images/x.png',
      'notes/a.mk.md',
      deps,
    );
    expect(resolved).toBe('images/x.png');
  });

  it('resolves to undefined when neither resolution finds anything', async () => {
    const deps = createFakeVault({});
    const resolved = await resolveVaultImagePath(
      'missing.png',
      'notes/a.mk.md',
      deps,
    );
    expect(resolved).toBeUndefined();
  });
});

describe('createVaultImageReader', () => {
  it('reads the bytes of a resolved, in-limit image', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const deps = createFakeVault({
      linkTargets: { 'logo.png': 'assets/logo.png' },
      files: { 'assets/logo.png': bytes },
    });
    const reader = createVaultImageReader('notes/a.mk.md', deps);
    const result = await reader('logo.png');
    expect(result).toEqual({ kind: 'bytes', bytes });
  });

  it('reports oversize from the stat alone, without reading the file', async () => {
    const bigSize = MAX_EMBEDDED_IMAGE_BYTES + 1;
    const deps: VaultImageReaderDeps = {
      linkpathDest: (src) =>
        src === 'huge.png' ? 'assets/huge.png' : undefined,
      pathExists: () => Promise.resolve(false),
      statSize: () => Promise.resolve(bigSize),
      readBinary: () => {
        throw new Error('should never be called for an oversize file');
      },
    };
    const reader = createVaultImageReader('notes/a.mk.md', deps);
    const result = await reader('huge.png');
    expect(result).toEqual({ kind: 'oversize', byteLength: bigSize });
  });

  it('reports unreadable when nothing resolves', async () => {
    const deps = createFakeVault({});
    const reader = createVaultImageReader('notes/a.mk.md', deps);
    const result = await reader('ghost.png');
    expect(result.kind).toBe('unreadable');
    if (result.kind !== 'unreadable') throw new Error('unreachable');
    expect(result.detail).toContain('ghost.png');
  });

  it('reports unreadable when stat throws', async () => {
    const deps = createFakeVault({
      linkTargets: { 'x.png': 'assets/x.png' },
      files: { 'assets/x.png': new Uint8Array([1]) },
      statFails: new Set(['assets/x.png']),
    });
    const reader = createVaultImageReader('notes/a.mk.md', deps);
    const result = await reader('x.png');
    expect(result.kind).toBe('unreadable');
    if (result.kind !== 'unreadable') throw new Error('unreachable');
    expect(result.detail).toContain('stat exploded');
  });

  it('reports unreadable when the size cannot be determined', async () => {
    const deps: VaultImageReaderDeps = {
      linkpathDest: () => 'assets/x.png',
      pathExists: () => Promise.resolve(false),
      statSize: () => Promise.resolve(undefined),
      readBinary: () => Promise.resolve(new Uint8Array()),
    };
    const reader = createVaultImageReader('notes/a.mk.md', deps);
    const result = await reader('x.png');
    expect(result.kind).toBe('unreadable');
  });

  it('reports unreadable when reading the bytes throws', async () => {
    const deps = createFakeVault({
      linkTargets: { 'x.png': 'assets/x.png' },
      files: { 'assets/x.png': new Uint8Array([1]) },
      readFails: new Set(['assets/x.png']),
    });
    const reader = createVaultImageReader('notes/a.mk.md', deps);
    const result = await reader('x.png');
    expect(result.kind).toBe('unreadable');
    if (result.kind !== 'unreadable') throw new Error('unreachable');
    expect(result.detail).toContain('read exploded');
  });
});
