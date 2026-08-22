import { zipSync, strToU8 } from 'fflate';
import { openZipBundle } from '@markii/bundle';
import type { BundleManifest, BundleStorage } from '@markii/bundle';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_EMBEDDED_ASSET_BYTES,
  bundleResolutionFailureMessage,
  extractAssetsAsDataUris,
  resolveBundleDocument,
  resolveBundleDocumentPath,
} from './bundle-resolve';

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
