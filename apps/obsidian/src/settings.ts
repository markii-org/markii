/**
 * Plugin settings — deliberately `obsidian`-free (see `src/main.ts`'s
 * file-scope note and `src/obsidian-import-guard.test.ts`) so the shape and
 * the hostile-input normalization stay unit-testable without the `obsidian`
 * module, the same split `src/render-document.tsx` already uses for the
 * render path.
 *
 * PERSISTENCE TIER — READ BEFORE ADDING A SETTING:
 * `MarkiiPlugin` persists this object with the ordinary Obsidian
 * `loadData`/`saveData` pair, which writes into the vault's plugin-data
 * JSON. That file travels with vault sync and vault sharing (anyone the
 * vault is shared with sees it). That is an acceptable trade for a purely
 * COSMETIC preference like `previewPlacement` below.
 *
 * It is NOT acceptable for any future setting that authorizes execution or
 * network access — auto-run, scheduled refresh, network grants, trusted
 * pack folders, anything in that family. Those must be persisted with
 * `app.saveLocalStorage`/`app.loadLocalStorage` instead, which is
 * device-local and does not sync or share. Do not fold a setting like that
 * into this file's `saveData`-backed shape without re-reading this note and
 * giving it its own device-local storage path.
 */

/** Where the command opens the preview view. */
export type PreviewPlacement = 'main' | 'right-sidebar';

/**
 * How wide the preview's text column is allowed to grow. Cosmetic, and the
 * same three-value vocabulary the VS Code extension's `markii.previewWidth`
 * uses, so the two hosts describe the reading measure the same way.
 */
export type PreviewWidth = 'normal' | 'wide' | 'full';

export interface MarkiiSettings {
  /**
   * 'main': a new tab in the main workspace area, split beside the active
   * editor (vertical split) — the default, since a document preview needs
   * document width, not the narrow utility sidebar.
   * 'right-sidebar': the original right side-leaf placement, kept as the
   * opt-in alternative for anyone who prefers a narrow always-visible panel.
   */
  previewPlacement: PreviewPlacement;
  /**
   * 'normal': the pane's own width, which is exactly how the preview has
   * always rendered here and stays the default.
   * 'wide': a fixed 64rem reading column, centered in the pane. The same
   * measure a `width=wide` block gets, for anyone who wants a stable line
   * length on a large screen.
   * 'full': the pane's width with wider gutters, for dashboard notes whose
   * rows and charts want every pixel.
   *
   * Obsidian gives this view the whole pane already, so unlike the VS Code
   * extension, where 'normal' is a 48rem column, the useful step here is
   * 'wide': it is what introduces a reading column rather than removing
   * one. 'normal' is left completely unstyled so the default rendering is
   * unchanged.
   */
  previewWidth: PreviewWidth;
}

export const DEFAULT_SETTINGS: MarkiiSettings = {
  previewPlacement: 'main',
  previewWidth: 'normal',
};

const PREVIEW_PLACEMENTS: readonly PreviewPlacement[] = [
  'main',
  'right-sidebar',
];

function isPreviewPlacement(value: unknown): value is PreviewPlacement {
  return (
    typeof value === 'string' &&
    (PREVIEW_PLACEMENTS as readonly string[]).includes(value)
  );
}

/** The width vocabulary, narrowest first, which is the order the dropdown offers them in. */
export const PREVIEW_WIDTHS: readonly PreviewWidth[] = [
  'normal',
  'wide',
  'full',
];

export function isPreviewWidth(value: unknown): value is PreviewWidth {
  return (
    typeof value === 'string' &&
    (PREVIEW_WIDTHS as readonly string[]).includes(value)
  );
}

/**
 * The class the view root carries for `width`, or `undefined` for
 * `normal`, which is styled by nothing at all so the default rendering is
 * byte-for-byte what it was. `src/obsidian-theme.css` holds the two rules.
 */
export function previewWidthClassName(width: PreviewWidth): string | undefined {
  switch (width) {
    case 'wide':
      return 'mk-obsidian-preview--wide';
    case 'full':
      return 'mk-obsidian-preview--full';
    default:
      return undefined;
  }
}

/** Every width class, so the view root can drop the previous one before adding the current one. */
export const PREVIEW_WIDTH_CLASSES: readonly string[] = [
  'mk-obsidian-preview--wide',
  'mk-obsidian-preview--full',
];

/**
 * Normalizes whatever `loadData()` handed back into a well-formed
 * `MarkiiSettings` — hostile-shape-guarded the same way
 * `apps/vscode/src/protocol.ts` guards its host<->webview messages, since
 * `loadData()`'s return type is `any` and the underlying JSON is
 * hand-editable vault data (a missing file, a stale key from an older
 * plugin version, or a manually corrupted `data.json` are all real inputs).
 */
export function normalizeSettings(data: unknown): MarkiiSettings {
  if (typeof data !== 'object' || data === null) {
    return { ...DEFAULT_SETTINGS };
  }
  const raw = data as Record<string, unknown>;
  return {
    previewPlacement: isPreviewPlacement(raw.previewPlacement)
      ? raw.previewPlacement
      : DEFAULT_SETTINGS.previewPlacement,
    previewWidth: isPreviewWidth(raw.previewWidth)
      ? raw.previewWidth
      : DEFAULT_SETTINGS.previewWidth,
  };
}
