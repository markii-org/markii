/**
 * Where a bundle's note lives and what a bundle is called on disk. Every
 * host that opens a `.mkz` (the VS Code preview, the CLI) asks these
 * questions, so the answers live here once.
 */
import type { BundleManifest } from '@markii/bundle';
import { normalizeBundlePath } from '@markii/bundle';

/** The conventional document path inside a bundle when the manifest does not name one (docs/bundles.md). */
export const DEFAULT_BUNDLE_DOCUMENT_PATH = 'note.mk.md';

/** The current bundle extension; new bundles are always written with this one. */
export const BUNDLE_EXTENSION = '.mkz';

/** The legacy bundle extension, still recognized. */
export const LEGACY_BUNDLE_EXTENSION = '.mkbundle';

/**
 * True when `name` ends with `.mkz` or the legacy `.mkbundle`
 * (case-insensitively) AND has a non-empty base name before the extension.
 */
export function isBundleName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const extension of [BUNDLE_EXTENSION, LEGACY_BUNDLE_EXTENSION]) {
    if (lower.endsWith(extension) && lower.length > extension.length) {
      return true;
    }
  }
  return false;
}

/**
 * The bundle-relative path of the document to open: the manifest's own
 * `document` field when it names one, normalized through the same path jail
 * every other bundle path goes through so a manifest cannot point outside
 * the bundle; otherwise the conventional `note.mk.md`.
 *
 * Returns `undefined` when a `document` field is present but not a usable
 * bundle-relative path (wrong type, or rejected by `normalizeBundlePath`,
 * including any path with a `..` segment). That is a manifest authoring
 * error, not something to ignore silently.
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
