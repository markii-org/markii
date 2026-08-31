/**
 * The preview column's reading measure — the `markii.previewWidth` setting
 * (`package.json`), read once per panel creation like every other
 * per-panel setting and threaded to the webview on each `update`
 * (`protocol.ts`).
 *
 * COSMETIC ONLY. Nothing here authorizes anything, so unlike `markii.packs`
 * and the run settings this one is not user-scope-locked: a workspace may
 * set it, because the worst a hostile workspace can do with it is make the
 * text column wider.
 *
 * `vscode`-free on purpose (see `extension.ts`'s file-scope note): the
 * value vocabulary, the hostile-input normalization, and the class name
 * the webview applies are all decided here, so they stay testable and so
 * the webview bundle can import them without pulling the extension host
 * in.
 */

/** The setting's closed vocabulary, narrowest first, which is the order the setting's dropdown offers them in. */
export const PREVIEW_WIDTHS = ['normal', 'wide', 'full'] as const;

export type PreviewWidth = (typeof PREVIEW_WIDTHS)[number];

/** The default: the 48rem reading column the preview has always used. */
export const DEFAULT_PREVIEW_WIDTH: PreviewWidth = 'normal';

export function isPreviewWidth(value: unknown): value is PreviewWidth {
  return (
    typeof value === 'string' &&
    (PREVIEW_WIDTHS as readonly string[]).includes(value)
  );
}

/**
 * Whatever the settings store or a `postMessage` handed over, reduced to a
 * real value. A missing, misspelled, or hostile value reads as the default
 * rather than erroring: a bad cosmetic setting is not worth a broken
 * preview.
 */
export function normalizePreviewWidth(value: unknown): PreviewWidth {
  return isPreviewWidth(value) ? value : DEFAULT_PREVIEW_WIDTH;
}

/**
 * The class the webview puts on its `.doc` element for `width`, or
 * `undefined` for `normal`, which is the plain `.doc` rule in `theme.css`
 * and so needs no class at all. Kept next to the vocabulary so a new value
 * cannot be added without deciding what it renders as.
 */
export function previewWidthClassName(width: PreviewWidth): string | undefined {
  switch (width) {
    case 'wide':
      return 'mk-preview--wide';
    case 'full':
      return 'mk-preview--full';
    default:
      return undefined;
  }
}

/** The `.doc` element's full class list for `width`. */
export function previewDocumentClassName(width: PreviewWidth): string {
  const modifier = previewWidthClassName(width);
  return modifier === undefined ? 'doc' : `doc ${modifier}`;
}
