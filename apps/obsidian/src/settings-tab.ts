import { App, PluginSettingTab, Setting } from 'obsidian';
import type MarkiiPlugin from './main.js';
import type { PreviewPlacement } from './settings.js';

/**
 * Imports `obsidian` — kept in its own file, alongside `src/main.ts` and
 * `src/view.tsx`, per this plugin's file-scope split (see
 * `src/obsidian-import-guard.test.ts`, whose allowlist this file was added
 * to). The setting VALUE and its normalization live in the plain
 * `src/settings.ts`; this file is wiring only — it draws the tab and wires
 * its one control to `plugin.settings`/`plugin.saveSettings()`.
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
  }

  private async applyPlacement(value: string): Promise<void> {
    const placement: PreviewPlacement =
      value === 'right-sidebar' ? 'right-sidebar' : 'main';
    this.plugin.settings = { previewPlacement: placement };
    await this.plugin.saveSettings();
  }
}
