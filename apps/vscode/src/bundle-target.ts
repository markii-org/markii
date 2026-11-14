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

import { isBundleName } from '@markii/host/internal';

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
