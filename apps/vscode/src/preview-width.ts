/**
 * The preview's COSMETIC appearance: the reading measure
 * (`markii.previewWidth`) and whether script blocks are hidden
 * (`markii.hideScriptBlocks`), both read once per panel creation like
 * every other per-panel setting and threaded to the webview on each
 * `update` (`protocol.ts`). Together they decide the one thing the webview
 * puts on its `.doc` element: its class list.
 *
 * COSMETIC ONLY. Nothing here authorizes anything, so unlike `markii.packs`
 * and the run settings these are not user-scope-locked: a workspace may
 * set them, because the worst a hostile workspace can do is make the text
 * column wider or fold the script markers away. Hiding script markers
 * hides the SOURCE blocks and nothing else: a failed script still shows
 * its per-value failure marker in the note, still flips the run marker to
 * its failed state, and its full reason is still written to the Markii
 * output channel.
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

/**
 * The class the webview puts on its `.doc` element when
 * `markii.hideScriptBlocks` is on. `theme.css` turns it into a single
 * `display: none` on `.mk-script`, the collapsed script marker
 * `@markii/react` renders for a `{name=...}` fence — and on nothing else,
 * so every failure surface stays exactly where it was.
 */
export const HIDE_SCRIPT_BLOCKS_CLASS = 'mk-preview--hide-scripts';

/** Whatever the settings store or a `postMessage` handed over, reduced to a real boolean; anything else reads as `false`, the way the preview has always rendered. */
export function normalizeHideScriptBlocks(value: unknown): boolean {
  return value === true;
}

/**
 * The `.doc` element's full class list, given the reading measure and
 * whether script blocks are hidden. The default pair (`normal`, not
 * hidden) is the bare `doc` the preview has always rendered.
 */
export function previewDocumentClassName(
  width: PreviewWidth,
  hideScriptBlocks = false,
): string {
  const classes = ['doc'];
  const modifier = previewWidthClassName(width);
  if (modifier !== undefined) classes.push(modifier);
  if (hideScriptBlocks) classes.push(HIDE_SCRIPT_BLOCKS_CLASS);
  return classes.join(' ');
}
