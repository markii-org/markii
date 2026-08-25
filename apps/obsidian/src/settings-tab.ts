import { App, PluginSettingTab, Setting } from 'obsidian';
import type MarkiiPlugin from './main.js';
import type { PreviewPlacement } from './settings.js';
import {
  MIN_REFRESH_INTERVAL_SECONDS,
  normalizeLocalSettings,
} from './local-settings.js';
import { appendPackFolder, removePackFolder } from './packs/pack-settings.js';

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
      .setDesc(
        'Where "Open Markii Preview" opens the preview. Main area gives ' +
          'the document readable width, split beside your note; right ' +
          'sidebar keeps it as a narrow, always-visible panel.',
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption('main', 'Main area (split beside the editor)')
          .addOption('right-sidebar', 'Right sidebar')
          .setValue(this.plugin.settings.previewPlacement)
          .onChange((value) => {
            void this.applyPlacement(value);
          });
      });

    containerEl.createEl('h3', { text: 'Scripting' });
    containerEl.createEl('p', {
      text:
        'These settings are stored on THIS DEVICE only (Obsidian’s ' +
        'local storage, not your vault). They never sync, and they never ' +
        'travel with a shared or cloned copy of this vault — the same is ' +
        'true of every network permission you grant a note’s scripts.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Run scripts when a note opens')
      .setDesc(
        'Runs a note’s scripts once, read-only, the first time its ' +
          'preview opens. Never prompts for network access on its own — ' +
          'it only reuses a permission you already granted by hand with ' +
          '"Run Markii scripts".',
      )
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
        `0 turns scheduled refresh off. A value below ` +
          `${String(MIN_REFRESH_INTERVAL_SECONDS)} is treated as ` +
          `${String(MIN_REFRESH_INTERVAL_SECONDS)}. Like run-on-open, a ` +
          'scheduled run is read-only and never prompts.',
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
      text:
        'Folders you trust as installed component packs (docs/packs.md). ' +
        'This list authorizes CODE EXECUTION — a pack’s sources are ' +
        'compiled and run to render its components, and its scripts/*.lua ' +
        'becomes require-able from your notes’ scripts. Like every ' +
        'setting on this page, it is stored on this device only and never ' +
        'syncs or travels with a shared or cloned vault. Absolute paths ' +
        'are preferred; a leading "~" expands to your home directory. ' +
        'Reloading a pack (after editing its source, or after changing ' +
        'this list) requires closing and reopening the Markii preview.',
      cls: 'setting-item-description',
    });

    for (const folder of this.plugin.packSettings.packFolders) {
      new Setting(containerEl).setName(folder).addExtraButton((button) => {
        button
          .setIcon('trash')
          .setTooltip('Remove this pack folder')
          .onClick(() => {
            this.applyPackFolderChange(
              removePackFolder(this.plugin.packSettings.packFolders, folder),
            );
          });
      });
    }

    let newFolderValue = '';
    new Setting(containerEl)
      .setName('Add a pack folder')
      .setDesc(
        'The folder itself, or a parent folder holding several packs ' +
          '(each immediate subfolder with its own pack.json counts as its ' +
          'own pack — one level deep, no recursion).',
      )
      .addText((text) => {
        text.setPlaceholder('/absolute/path/to/pack').onChange((value) => {
          newFolderValue = value;
        });
      })
      .addButton((button) => {
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
    this.plugin.settings = { previewPlacement: placement };
    await this.plugin.saveSettings();
  }
}
