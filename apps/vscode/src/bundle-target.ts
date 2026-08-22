/**
 * Bundle-target classification, shared by `extension.ts`/`preview-panel.ts`.
 * Kept `vscode`-free (plain strings/booleans in, plain values out) so it is
 * unit-tested TypeScript, matching `mark-document.ts`'s split.
 *
 * A Markii bundle is recognized by name alone, in either physical form: a
 * DIRECTORY named `*.mkz` (or the legacy `*.mkbundle`), or a ZIP FILE with
 * the same extension — `@markii/bundle`'s README documents `.mkbundle` as
 * "still recognized for one more release", so both are accepted here too.
 */

/** The current bundle extension; new bundles are always written with this one. */
export const BUNDLE_EXTENSION = '.mkz';

/** The legacy bundle extension, still recognized (see this file's doc comment). */
export const LEGACY_BUNDLE_EXTENSION = '.mkbundle';

/**
 * True when `name` ends with `.mkz` or `.mkbundle` (case-insensitively) AND
 * has a non-empty base name before the extension — mirrors
 * `mark-document.ts`'s `isMarkFileName` rule that a bare extension with
 * nothing in front is not a valid name.
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

/** What a filesystem entry at a bundle-shaped name turns out to be. */
export type BundleTargetKind = 'directory' | 'zip' | 'not-a-bundle';

/**
 * Classifies a filesystem entry named `name` as a bundle directory, a bundle
 * zip file, or not a bundle at all — pure name + shape logic, with the
 * actual `stat` call left to the caller (`preview-panel.ts`, the only place
 * allowed to touch `vscode.workspace.fs`).
 */
export function classifyBundleTarget(
  name: string,
  isDirectory: boolean,
): BundleTargetKind {
  if (!isBundleName(name)) return 'not-a-bundle';
  return isDirectory ? 'directory' : 'zip';
}

/**
 * The webview panel's tab title for a bundle preview — "Preview note.mkz",
 * with a plain, quiet "(read-only)" suffix for the zip form (there is no
 * editable buffer behind it, unlike the directory form's real
 * `note.mk.md` file) so the state is obvious without anything appearing
 * inside the rendered document itself (AGENTS.md's cleanliness principle:
 * the rendered page stays clean, the marker lives in panel chrome).
 */
export function bundlePreviewTitleFor(
  bundleName: string,
  readOnly: boolean,
): string {
  return readOnly
    ? `Preview ${bundleName} (read-only)`
    : `Preview ${bundleName}`;
}
