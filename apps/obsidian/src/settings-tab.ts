import { App, PluginSettingTab, Setting } from 'obsidian';
import type MarkiiPlugin from './main.js';
import type { PreviewPlacement, PreviewWidth } from './settings.js';
import { MARKII_PREVIEW_VIEW_TYPE, MarkiiPreviewView } from './view.js';
import {
  MIN_REFRESH_INTERVAL_SECONDS,
  normalizeLocalSettings,
} from './local-settings.js';
import { appendPackFolder, removePackFolder } from './packs/pack-settings.js';
import { resolvePackPaths } from '@markii/host';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { folderPickerAvailable, pickFolder } from './pick-folder.js';

/**
 * Imports `obsidian` — kept in its own file, alongside `src/main.ts`,
 * `src/view.tsx`, and `src/run-modals.ts`, per this plugin's file-scope
 * split (see `src/obsidian-import-guard.test.ts`, whose allowlist this file
 * was added to). The setting VALUES and their normalization live in the
 * plain `src/settings.ts`/`src/local-settings.ts`; this file is wiring
 * only — it draws the tab and wires its controls to `plugin.settings`/
 * `plugin.saveSettings()` (cosmetic, vault-synced) or
 * `plugin.localSettings`/`plugin.saveLocalSettings()` (device-local).
 *
 * Registering this tab (`Plugin.addSettingTab` in `src/main.ts`) is what
 * makes "Markii" appear under Settings -> Community plugins in the left
 * sidebar; without one, a plugin only shows up under "Installed plugins"
 * with nothing to click into.
 */
export class MarkiiSettingTab extends PluginSettingTab {
  private readonly plugin: MarkiiPlugin;

  constructor(app: App, plugin: MarkiiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Preview placement')
      .setDesc('Where the preview opens.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('main', 'Main area (split beside the editor)')
          .addOption('right-sidebar', 'Right sidebar')
          .setValue(this.plugin.settings.previewPlacement)
          .onChange((value) => {
            void this.applyPlacement(value);
          });
      });

    new Setting(containerEl)
      .setName('Preview width')
      .setDesc(
        "How wide the preview's text column may grow. Normal keeps the pane's width.",
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption('normal', "Normal, the pane's width")
          .addOption('wide', 'Wide, a 64rem reading column')
          .addOption('full', 'Full, the pane with wider gutters')
          .setValue(this.plugin.settings.previewWidth)
          .onChange((value) => {
            void this.applyWidth(value);
          });
      });

    containerEl.createEl('h3', { text: 'Scripting' });
    containerEl.createEl('p', {
      text: 'Stored on this device only. Never synced, never shared.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Run scripts when a note opens')
      .setDesc('Read-only, once per preview. Never prompts.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.localSettings.runOnOpen)
          .onChange((value) => {
            this.plugin.saveLocalSettings({
              ...this.plugin.localSettings,
              runOnOpen: value,
            });
          });
      });

    new Setting(containerEl)
      .setName('Scheduled refresh interval (seconds)')
      .setDesc(
        `0 is off. Minimum ${String(MIN_REFRESH_INTERVAL_SECONDS)} seconds.`,
      )
      .addText((text) => {
        text
          .setValue(String(this.plugin.localSettings.refreshIntervalSeconds))
          .onChange((value) => {
            const seconds = Number(value);
            const normalized = normalizeLocalSettings({
              ...this.plugin.localSettings,
              refreshIntervalSeconds: Number.isFinite(seconds)
                ? Math.max(0, Math.trunc(seconds))
                : 0,
            });
            this.plugin.saveLocalSettings(normalized);
          });
      });

    containerEl.createEl('h3', { text: 'Component packs' });
    containerEl.createEl('p', {
      text: 'Adding a folder lets its code run. Only add folders you trust.',
      cls: 'setting-item-description',
    });

    // Show what each entry actually RESOLVES to, not the raw string the
    // user typed: a `~` or `./` entry means nothing on its own, and a
    // folder that does not exist would otherwise fail silently at load
    // time with the settings tab still looking correct. A path that is
    // shell-escaped (`Obsidian\ Github`) is the common way to get a
    // missing folder here, and this is what makes that visible.
    const configured = this.plugin.packSettings.packFolders;
    const resolved = resolvePackPaths(
      configured,
      this.plugin.vaultBasePath(),
      homedir(),
    );
    for (const [index, folder] of configured.entries()) {
      const absolute = resolved[index] ?? folder;
      const found = existsSync(absolute);
      const row = new Setting(containerEl)
        .setName(absolute)
        .setDesc(found ? '' : 'Folder not found.');
      if (!found) row.descEl.addClass('mod-warning');
      row.addExtraButton((button) => {
        button
          .setIcon('trash')
          .setTooltip('Remove this pack folder')
          .onClick(() => {
            this.applyPackFolderChange(removePackFolder(configured, folder));
          });
      });
    }

    let newFolderValue = '';
    const addFolder = new Setting(containerEl)
      .setName('Add a pack folder')
      .setDesc('One pack, or a folder of packs. "~" and "./" both work.')
      .addText((text) => {
        text.setPlaceholder('/absolute/path/to/pack').onChange((value) => {
          newFolderValue = value;
        });
      });

    if (folderPickerAvailable()) {
      addFolder.addButton((button) => {
        button.setButtonText('Browse').onClick(() => {
          void pickFolder().then((picked) => {
            if (picked === undefined) return;
            this.applyPackFolderChange(
              appendPackFolder(this.plugin.packSettings.packFolders, picked),
            );
          });
        });
      });
    }

    addFolder.addButton((button) => {
      button.setButtonText('Add').onClick(() => {
        this.applyPackFolderChange(
          appendPackFolder(
            this.plugin.packSettings.packFolders,
            newFolderValue,
          ),
        );
      });
    });
  }

  /** Writes a new pack-folder list (or does nothing when the change was a no-op, e.g. adding a duplicate or removing an absent entry — see `appendPackFolder`/`removePackFolder`'s own doc comments) and redraws the tab so the list reflects it immediately. */
  private applyPackFolderChange(next: string[] | undefined): void {
    if (next === undefined) return;
    this.plugin.savePackSettings({ packFolders: next });
    this.display();
  }

  private async applyPlacement(value: string): Promise<void> {
    const placement: PreviewPlacement =
      value === 'right-sidebar' ? 'right-sidebar' : 'main';
    this.plugin.settings = {
      ...this.plugin.settings,
      previewPlacement: placement,
    };
    await this.plugin.saveSettings();
  }

  /**
   * Writes the preview width and applies it to every preview that is
   * already open, so the dropdown changes what the reader is looking at
   * instead of only what the next preview will look like. Purely cosmetic,
   * which is why it lives in the vault-synced settings beside placement.
   */
  private async applyWidth(value: string): Promise<void> {
    const width: PreviewWidth =
      value === 'wide' || value === 'full' ? value : 'normal';
    this.plugin.settings = { ...this.plugin.settings, previewWidth: width };
    await this.plugin.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(
      MARKII_PREVIEW_VIEW_TYPE,
    )) {
      if (leaf.view instanceof MarkiiPreviewView) {
        leaf.view.applyPreviewWidth();
      }
    }
  }
}
