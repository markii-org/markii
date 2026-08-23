import { zipSync, strToU8 } from 'fflate';
import { openZipBundle } from '@markii/bundle';
import type { BundleManifest, BundleStorage } from '@markii/bundle';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_EMBEDDED_ASSET_BYTES,
  MAX_BUNDLE_TEXT_FILE_BYTES,
  MAX_ZIP_ARCHIVE_BYTES,
  bundleResolutionFailureMessage,
  extractAssetsAsDataUris,
  resolveBundleDocument,
  resolveBundleDocumentPath,
  zipArchiveTooLarge,
} from './bundle-resolve';

/**
 * A `BundleStorage` whose `size()` for one chosen path lies about being huge
 * (C-1's guard needs a size check, not real gigabyte-scale test content) —
 * `read()` on that same path is instrumented so a test can assert it was
 * NEVER called, proving the guard actually short-circuits before reading.
 */
function storageWithOversizedPath(
  files: Record<string, string>,
  oversizedPath: string,
  oversizedSize: number,
): { storage: BundleStorage; readCalls: string[] } {
  const map = new Map<string, Uint8Array>(
    Object.entries(files).map(([path, text]) => [path, strToU8(text)]),
  );
  const readCalls: string[] = [];
  return {
    storage: {
      async read(path) {
        readCalls.push(path);
        return map.get(path);
      },
      async write(path, data) {
        map.set(path, data);
      },
      async list() {
        return [...map.keys()].sort();
      },
      async exists(path) {
        return map.has(path);
      },
      async size(path) {
        if (path === oversizedPath) return oversizedSize;
        return map.get(path)?.length;
      },
    },
    readCalls,
  };
}

function zipStorage(files: Record<string, string | Uint8Array>): BundleStorage {
  const encoded: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    encoded[path] = typeof content === 'string' ? strToU8(content) : content;
  }
  return openZipBundle(zipSync(encoded));
}

function manifestJson(manifest: BundleManifest): string {
  return JSON.stringify(manifest);
}

describe('resolveBundleDocumentPath', () => {
  it('defaults to note.mk.md when the manifest names no document', () => {
    expect(resolveBundleDocumentPath({ mark: '0.1.0' })).toBe('note.mk.md');
  });

  it('uses the manifest-named document when it is a valid bundle-relative path', () => {
    expect(
      resolveBundleDocumentPath({ mark: '0.1.0', document: 'main.mk.md' }),
    ).toBe('main.mk.md');
  });

  it('rejects a non-string document field', () => {
    expect(
      resolveBundleDocumentPath({ mark: '0.1.0', document: 42 as never }),
    ).toBeUndefined();
  });

  it('fails closed on a traversal attempt in the document field', () => {
    expect(
      resolveBundleDocumentPath({
        mark: '0.1.0',
        document: '../outside.mk.md',
      }),
    ).toBeUndefined();
    expect(
      resolveBundleDocumentPath({
        mark: '0.1.0',
        document: '../'.repeat(5) + 'etc/passwd',
      }),
    ).toBeUndefined();
  });

  it('rejects an absolute path in the document field', () => {
    expect(
      resolveBundleDocumentPath({ mark: '0.1.0', document: '/etc/passwd' }),
    ).toBeUndefined();
  });
});

describe('resolveBundleDocument', () => {
  it('resolves the conventional note.mk.md', async () => {
    const storage = zipStorage({
      'manifest.json': manifestJson({ mark: '0.1.0' }),
      'note.mk.md': '# Hello',
    });
    const result = await resolveBundleDocument(storage);
    expect(result).toEqual({
      ok: true,
      manifest: { mark: '0.1.0' },
      documentPath: 'note.mk.md',
      text: '# Hello',
    });
  });

  it('resolves a manifest-named document', async () => {
    const storage = zipStorage({
      'manifest.json': manifestJson({ mark: '0.1.0', document: 'main.mk.md' }),
      'main.mk.md': '# Main',
    });
    const result = await resolveBundleDocument(storage);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.documentPath).toBe('main.mk.md');
      expect(result.text).toBe('# Main');
    }
  });

  it('degrades quietly when manifest.json is missing', async () => {
    const storage = zipStorage({ 'note.mk.md': '# Hello' });
    const result = await resolveBundleDocument(storage);
    expect(result).toEqual({ ok: false, reason: 'manifest-missing' });
  });

  it('degrades quietly on malformed JSON', async () => {
    const storage = zipStorage({
      'manifest.json': '{ not json',
      'note.mk.md': '# Hello',
    });
    const result = await resolveBundleDocument(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('manifest-invalid');
  });

  it('degrades quietly on a manifest missing the required "mark" field', async () => {
    const storage = zipStorage({
      'manifest.json': '{}',
      'note.mk.md': '# Hello',
    });
    const result = await resolveBundleDocument(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('manifest-invalid');
  });

  it('degrades quietly on a hostile manifest (wrong root shape)', async () => {
    const storage = zipStorage({
      'manifest.json': '[1, 2, 3]',
      'note.mk.md': '# Hello',
    });
    const result = await resolveBundleDocument(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('manifest-invalid');
  });

  it('degrades quietly when the resolved document is missing', async () => {
    const storage = zipStorage({
      'manifest.json': manifestJson({ mark: '0.1.0' }),
    });
    const result = await resolveBundleDocument(storage);
    expect(result).toEqual({
      ok: false,
      reason: 'document-missing',
      detail: 'note.mk.md',
    });
  });

  it('degrades quietly when a manifest-named document traverses outside the bundle', async () => {
    const storage = zipStorage({
      'manifest.json': manifestJson({
        mark: '0.1.0',
        document: '../outside.mk.md',
      }),
      'note.mk.md': '# Hello',
    });
    const result = await resolveBundleDocument(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('manifest-invalid');
  });

  it('C-1: refuses an over-budget manifest.json without ever reading it', async () => {
    const { storage, readCalls } = storageWithOversizedPath(
      { 'note.mk.md': '# Hello' },
      'manifest.json',
      MAX_BUNDLE_TEXT_FILE_BYTES + 1,
    );
    const result = await resolveBundleDocument(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('manifest-too-large');
    expect(readCalls).not.toContain('manifest.json');
  });

  it('C-1: refuses an over-budget document without ever reading it', async () => {
    const { storage, readCalls } = storageWithOversizedPath(
      { 'manifest.json': manifestJson({ mark: '0.1.0' }) },
      'note.mk.md',
      MAX_BUNDLE_TEXT_FILE_BYTES + 1,
    );
    const result = await resolveBundleDocument(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('document-too-large');
    expect(readCalls).not.toContain('note.mk.md');
  });

  it('accepts a manifest/document exactly at the size limit', async () => {
    const { storage } = storageWithOversizedPath(
      {
        'manifest.json': manifestJson({ mark: '0.1.0' }),
        'note.mk.md': '# Hello',
      },
      'manifest.json',
      manifestJson({ mark: '0.1.0' }).length,
    );
    const result = await resolveBundleDocument(storage);
    expect(result.ok).toBe(true);
  });
});

describe('bundleResolutionFailureMessage', () => {
  it('gives a short, specific, non-stack-trace sentence per reason', () => {
    expect(bundleResolutionFailureMessage('manifest-missing')).toMatch(
      /manifest/i,
    );
    expect(bundleResolutionFailureMessage('manifest-invalid')).toMatch(
      /manifest/i,
    );
    expect(bundleResolutionFailureMessage('document-missing')).toMatch(
      /document/i,
    );
    expect(bundleResolutionFailureMessage('manifest-too-large')).toMatch(
      /manifest/i,
    );
    expect(bundleResolutionFailureMessage('document-too-large')).toMatch(
      /document/i,
    );
  });
});

describe('extractAssetsAsDataUris', () => {
  it('extracts recognized image types under assets/ as data URIs', async () => {
    const storage = zipStorage({
      'manifest.json': manifestJson({ mark: '0.1.0' }),
      'note.mk.md': '# Hello',
      'assets/nice.png': new Uint8Array([1, 2, 3, 4]),
      'assets/readme.txt': 'not an image',
    });
    const assets = await extractAssetsAsDataUris(storage);
    expect(Object.keys(assets)).toEqual(['assets/nice.png']);
    expect(assets['assets/nice.png']).toMatch(/^data:image\/png;base64,/);
  });

  it('returns an empty map when there is no assets/ directory', async () => {
    const storage = zipStorage({
      'manifest.json': manifestJson({ mark: '0.1.0' }),
      'note.mk.md': '# Hello',
    });
    expect(await extractAssetsAsDataUris(storage)).toEqual({});
  });

  it('stops extracting once the total budget would be exceeded, quietly', async () => {
    const big = new Uint8Array(10);
    const storage = zipStorage({
      'manifest.json': manifestJson({ mark: '0.1.0' }),
      'note.mk.md': '# Hello',
      'assets/a.png': big,
      'assets/b.png': big,
    });
    const assets = await extractAssetsAsDataUris(storage, {
      maxTotalBytes: 10,
    });
    // Only the first (alphabetically sorted) entry fits the budget.
    expect(Object.keys(assets)).toEqual(['assets/a.png']);
  });

  it('has a sane default budget', () => {
    expect(DEFAULT_MAX_EMBEDDED_ASSET_BYTES).toBeGreaterThan(0);
  });
});

describe('zipArchiveTooLarge (P2-b: bound the archive open by on-disk size)', () => {
  it('accepts an archive at or under the cap', () => {
    expect(zipArchiveTooLarge(0)).toBe(false);
    expect(zipArchiveTooLarge(1024)).toBe(false);
    expect(zipArchiveTooLarge(MAX_ZIP_ARCHIVE_BYTES)).toBe(false);
  });

  it('refuses an archive over the cap, so a giant .mkz is never read whole', () => {
    expect(zipArchiveTooLarge(MAX_ZIP_ARCHIVE_BYTES + 1)).toBe(true);
    expect(zipArchiveTooLarge(4 * 1024 * 1024 * 1024)).toBe(true);
  });
});
