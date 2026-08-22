/**
 * Bundle-content resolution: given a `@markii/bundle` `BundleStorage`
 * (either physical form — directory via `openDirBundle`, zip via
 * `openZipBundle` — both implement the exact same interface), work out
 * what to preview and how, without ever touching `vscode` or the real
 * filesystem itself. `preview-panel.ts` (the only place allowed to import
 * `vscode` alongside `extension.ts`) does the actual I/O — opening the
 * storage, calling these functions, and turning the result into panel
 * state or a quiet error message.
 *
 * Kept dependency-free beyond `@markii/bundle` itself, so it is plain,
 * unit-tested TypeScript exercisable with an in-memory `BundleStorage`.
 */

import type { BundleManifest, BundleStorage } from '@markii/bundle';
import { normalizeBundlePath, parseManifest } from '@markii/bundle';

/** The conventional document path inside a bundle when the manifest doesn't name one — spec's `docs/bundles.md` layout. */
export const DEFAULT_BUNDLE_DOCUMENT_PATH = 'note.mk.md';

const MANIFEST_PATH = 'manifest.json';

/** Reasons a bundle can fail to resolve into something previewable — each maps to one quiet, specific message; never a raw error dump (AGENTS.md's cleanliness principle). */
export type BundleResolutionFailureReason =
  | 'manifest-missing'
  | 'manifest-invalid'
  | 'manifest-too-large'
  | 'document-missing'
  | 'document-too-large';

/**
 * C-1 fix: a manifest or document over this many bytes is refused WITHOUT
 * being read into memory at all — `storage.size()` is consulted before
 * `storage.read()` (mirroring `apps/vscode/src/run/bundle-run.ts`'s
 * `buildBundleSnapshot`). A real `manifest.json`/`note.mk.md` is tiny; this
 * exists only so a delivered bundle whose "document" is actually a
 * multi-gigabyte file can never force that allocation in the extension
 * host just by being opened for preview.
 */
export const MAX_BUNDLE_TEXT_FILE_BYTES = 5 * 1024 * 1024;

export type BundleResolution =
  | {
      readonly ok: true;
      readonly manifest: BundleManifest;
      readonly documentPath: string;
      readonly text: string;
    }
  | {
      readonly ok: false;
      readonly reason: BundleResolutionFailureReason;
      /** A short, non-stack-trace detail for logging — never shown verbatim as the on-screen message. */
      readonly detail?: string;
    };

const utf8Decoder = new TextDecoder('utf-8', { fatal: false });

/**
 * The bundle-relative path of the document to preview: the manifest's own
 * `document` field when it names one (a forward-compatible, unvalidated-by
 * `@markii/bundle` extension point — `BundleManifest`'s index signature
 * allows it), normalized through the same path-jail every other bundle path
 * goes through so a manifest cannot point the preview outside the bundle;
 * otherwise the spec's conventional `note.mk.md`.
 *
 * Returns `undefined` when a `document` field is present but not a usable
 * bundle-relative path (wrong type, or rejected by `normalizeBundlePath` —
 * including any path carrying a `..` segment) — that is a manifest
 * authoring error, reported as `manifest-invalid`, not silently ignored.
 */
export function resolveBundleDocumentPath(
  manifest: BundleManifest,
): string | undefined {
  const raw = manifest.document;
  if (raw === undefined) return DEFAULT_BUNDLE_DOCUMENT_PATH;
  if (typeof raw !== 'string') return undefined;
  const normalized = normalizeBundlePath(raw);
  return normalized.ok ? normalized.path : undefined;
}

/**
 * Reads and validates a bundle's manifest, then resolves and reads its
 * document — the one entry point `preview-panel.ts` calls for both the
 * directory and zip forms (they hand it different `BundleStorage`
 * implementations, but the resolution logic is identical either way).
 */
export async function resolveBundleDocument(
  storage: BundleStorage,
): Promise<BundleResolution> {
  const manifestSize = await storage.size(MANIFEST_PATH);
  if (manifestSize === undefined) {
    return { ok: false, reason: 'manifest-missing' };
  }
  if (manifestSize > MAX_BUNDLE_TEXT_FILE_BYTES) {
    return {
      ok: false,
      reason: 'manifest-too-large',
      detail: `manifest.json is ${manifestSize} bytes, exceeding the ${MAX_BUNDLE_TEXT_FILE_BYTES}-byte limit`,
    };
  }

  const manifestBytes = await storage.read(MANIFEST_PATH);
  if (manifestBytes === undefined) {
    return { ok: false, reason: 'manifest-missing' };
  }

  const manifestJson = utf8Decoder.decode(manifestBytes);
  const parsed = parseManifest(manifestJson);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: 'manifest-invalid',
      detail: parsed.errors.join('; '),
    };
  }

  const documentPath = resolveBundleDocumentPath(parsed.manifest);
  if (documentPath === undefined) {
    return {
      ok: false,
      reason: 'manifest-invalid',
      detail: `manifest "document" field (${JSON.stringify(parsed.manifest.document)}) is not a valid bundle-relative path`,
    };
  }

  const documentSize = await storage.size(documentPath);
  if (documentSize === undefined) {
    return { ok: false, reason: 'document-missing', detail: documentPath };
  }
  if (documentSize > MAX_BUNDLE_TEXT_FILE_BYTES) {
    return {
      ok: false,
      reason: 'document-too-large',
      detail: `${documentPath} is ${documentSize} bytes, exceeding the ${MAX_BUNDLE_TEXT_FILE_BYTES}-byte limit`,
    };
  }

  const documentBytes = await storage.read(documentPath);
  if (documentBytes === undefined) {
    return { ok: false, reason: 'document-missing', detail: documentPath };
  }

  return {
    ok: true,
    manifest: parsed.manifest,
    documentPath,
    text: utf8Decoder.decode(documentBytes),
  };
}

/**
 * A short, quiet, user-facing sentence for a resolution failure — the
 * cleanliness principle again: no manifest error text, no path, no stack,
 * ever reaches the panel verbatim. `detail` stays available on the
 * `BundleResolution` itself for `console.error`-only logging.
 */
export function bundleResolutionFailureMessage(
  reason: BundleResolutionFailureReason,
): string {
  switch (reason) {
    case 'manifest-missing':
      return 'This bundle has no manifest.json and cannot be opened.';
    case 'manifest-invalid':
      return "This bundle's manifest.json is invalid and cannot be opened.";
    case 'manifest-too-large':
      return "This bundle's manifest.json is too large to open.";
    case 'document-missing':
      return "This bundle's document could not be found.";
    case 'document-too-large':
      return "This bundle's document is too large to open.";
  }
}

/** Image types embedded as data URIs for a read-only zip-form preview — deliberately narrow: only formats a `<img src>` can actually display. */
const EMBEDDABLE_ASSET_MIME_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

/** Total embedded-asset budget: a generous allowance for a single note's images, small enough that a large or hostile bundle degrades (quietly — missing images, never a crash) rather than ballooning webview memory. */
export const DEFAULT_MAX_EMBEDDED_ASSET_BYTES = 20 * 1024 * 1024;

export interface ExtractAssetsOptions {
  readonly maxTotalBytes?: number;
}

function base64OfBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Reads every recognized image under `assets/` in `storage` and returns a
 * map from its bundle-relative path (e.g. `assets/nice.png`) to a `data:`
 * URI — the zip-form counterpart to the directory form's ordinary
 * `localResourceRoots`-covered file access. A webview cannot reach into a
 * zip archive at all, so this is the chosen way to surface bundled images
 * for a read-only preview (see AGENTS.md-adjacent design note in
 * `preview-panel.ts`).
 *
 * Deliberately quiet under pressure: an unrecognized extension is skipped
 * (not every file under `assets/` is an image), and once the running total
 * would exceed `maxTotalBytes` extraction simply stops — remaining images
 * are absent rather than the whole preview failing.
 */
export async function extractAssetsAsDataUris(
  storage: BundleStorage,
  options: ExtractAssetsOptions = {},
): Promise<Record<string, string>> {
  const maxTotalBytes =
    options.maxTotalBytes ?? DEFAULT_MAX_EMBEDDED_ASSET_BYTES;

  const allPaths = await storage.list();
  const assetPaths = allPaths
    .filter((path) => path.startsWith('assets/'))
    .sort();

  const result: Record<string, string> = {};
  let total = 0;

  for (const path of assetPaths) {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    const mime = EMBEDDABLE_ASSET_MIME_TYPES[extension];
    if (mime === undefined) continue;

    const bytes = await storage.read(path);
    if (bytes === undefined) continue;
    if (total + bytes.length > maxTotalBytes) break;

    total += bytes.length;
    result[path] = `data:${mime};base64,${base64OfBytes(bytes)}`;
  }

  return result;
}
