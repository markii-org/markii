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

export interface MarkiiSettings {
  /**
   * 'main': a new tab in the main workspace area, split beside the active
   * editor (vertical split) — the default, since a document preview needs
   * document width, not the narrow utility sidebar.
   * 'right-sidebar': the original right side-leaf placement, kept as the
   * opt-in alternative for anyone who prefers a narrow always-visible panel.
   */
  previewPlacement: PreviewPlacement;
}

export const DEFAULT_SETTINGS: MarkiiSettings = {
  previewPlacement: 'main',
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
  };
}
