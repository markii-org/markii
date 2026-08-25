import { Plugin, WorkspaceLeaf } from 'obsidian';
import { MARKII_PREVIEW_VIEW_TYPE, MarkiiPreviewView } from './view.js';
import { MarkiiSettingTab } from './settings-tab.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js';
import type { MarkiiSettings } from './settings.js';

/**
 * Imports `obsidian` — deliberately NOT unit-tested (Vitest cannot resolve
 * `obsidian`), per this plugin's file-scope split (see
 * `src/obsidian-import-guard.test.ts`). Every piece of logic worth testing
 * in isolation (the document -> React render, the settings shape) already
 * lives in plain modules (`src/render-document.tsx`, `src/settings.ts`);
 * this file, `src/view.tsx`, and `src/settings-tab.ts` are wiring only.
 *
 * Deliberately minimal (feasibility spike, per the task): one view type,
 * one command, one cosmetic setting, no scripting, no packs.
 */
export default class MarkiiPlugin extends Plugin {
  settings: MarkiiSettings = DEFAULT_SETTINGS;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      MARKII_PREVIEW_VIEW_TYPE,
      (leaf) => new MarkiiPreviewView(leaf),
    );

    this.addSettingTab(new MarkiiSettingTab(this.app, this));

    this.addCommand({
      id: 'open-markii-preview',
      name: 'Open Markii Preview',
      callback: () => {
        void this.openPreview();
      },
    });
  }

  /**
   * See the PERSISTENCE TIER note atop `src/settings.ts`: `loadData`/
   * `saveData` write into the vault (syncs/shares with it), which is fine
   * for this cosmetic placement preference and NOT fine for any future
   * setting that grants execution or network access — those need
   * `app.saveLocalStorage`/`app.loadLocalStorage` instead.
   */
  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async openPreview(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(
      MARKII_PREVIEW_VIEW_TYPE,
    );
    const leaf: WorkspaceLeaf = existing[0] ?? this.newPreviewLeaf();

    await leaf.setViewState({ type: MARKII_PREVIEW_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /** Placement per `this.settings.previewPlacement` (FIX 1 + FIX 3). */
  private newPreviewLeaf(): WorkspaceLeaf {
    if (this.settings.previewPlacement === 'right-sidebar') {
      return (
        this.app.workspace.getRightLeaf(false) ??
        this.app.workspace.getLeaf(true)
      );
    }
    // Main workspace area, as a new tab split beside the active editor
    // (vertical split) — a document preview needs document width, not the
    // narrow utility sidebar.
    return this.app.workspace.getLeaf('split', 'vertical');
  }
}
