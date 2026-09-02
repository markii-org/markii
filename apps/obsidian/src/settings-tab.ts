import { App, MarkdownView, PluginSettingTab, Setting } from 'obsidian';
import type MarkiiPlugin from './main.js';
import type { PreviewPlacement, PreviewWidth } from './settings.js';
import { MARKII_PREVIEW_VIEW_TYPE, MarkiiPreviewView } from './view.js';
import {
  MIN_REFRESH_INTERVAL_SECONDS,
  normalizeLocalSettings,
} from './local-settings.js';
import { bundledDiscoveredPacks } from './packs/bundled-packs.js';

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

    new Setting(containerEl)
      .setName('Hide script blocks')
      .setDesc(
        'Leaves script markers out of the preview. Failures still show on the values they feed.',
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.hideScriptBlocks)
          .onChange((value) => {
            void this.applyHideScriptBlocks(value);
          });
      });

    new Setting(containerEl)
      .setName('Render components in Reading view')
      .setDesc(
        'Shows a .mk.md note’s components inline in Reading view, not only in the Markii Preview pane. Turning this off only stops that inline rendering; the preview pane keeps working.',
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.inlineReadingView)
          .onChange((value) => {
            void this.applyInlineReadingView(value);
          });
      });

    containerEl.createEl('h3', { text: 'Scripting' });
    containerEl.createEl('p', {
      text: 'Stored on this device only. Never synced, never shared.',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('Turn off script execution on this device')
      .setDesc('No note runs its scripts. Your grants are left as they are.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.localSettings.scriptsDisabled)
          .onChange((value) => {
            this.plugin.saveLocalSettings({
              ...this.plugin.localSettings,
              scriptsDisabled: value,
            });
          });
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
      text: 'Install a pack with the "Install Markii pack from file" command. Installing lets its code run.',
      cls: 'setting-item-description',
    });

    containerEl.createEl('h4', { text: 'Built in' });
    for (const pack of bundledDiscoveredPacks()) {
      new Setting(containerEl)
        .setName(pack.manifest.name)
        .setDesc('Built in. Cannot be removed.');
    }

    containerEl.createEl('h4', { text: 'Installed packs' });
    const bundledNamespaces = new Set(
      bundledDiscoveredPacks().map((pack) => pack.manifest.name),
    );
    const installed = (this.plugin.packContext?.packs ?? []).filter(
      (pack) => !bundledNamespaces.has(pack.manifest.name),
    );
    if (installed.length === 0) {
      containerEl.createEl('p', {
        text: 'No packs installed.',
        cls: 'setting-item-description',
      });
    }
    for (const pack of installed) {
      const row = new Setting(containerEl)
        .setName(pack.manifest.name)
        .setDesc(
          pack.manifest.version
            ? `Version ${pack.manifest.version}`
            : 'No declared version.',
        );
      row.addExtraButton((button) => {
        button
          .setIcon('trash')
          .setTooltip('Remove this pack')
          .onClick(() => {
            void this.plugin
              .removeInstalledPack(pack.manifest.name)
              .then(() => this.display());
          });
      });
    }

    if (this.plugin.notEnabledPackNamespaces.length > 0) {
      containerEl.createEl('h4', { text: 'Present, not enabled' });
      containerEl.createEl('p', {
        text: 'These folders were found on this device but are not trusted here yet, likely from Sync or a hand copy.',
        cls: 'setting-item-description',
      });
      for (const namespace of this.plugin.notEnabledPackNamespaces) {
        new Setting(containerEl)
          .setName(namespace)
          .setDesc('Present, not enabled on this device.')
          .addButton((button) => {
            button.setButtonText('Enable').onClick(() => {
              void this.plugin
                .enablePresentPack(namespace)
                .then(() => this.display());
            });
          });
      }
    }
  }

  /**
   * Writes the hide-script-blocks preference and applies it to every
   * preview that is already open, so the toggle changes what the reader is
   * looking at instead of only what the next preview will look like.
   * Purely cosmetic, which is why it lives in the vault-synced settings
   * beside placement and width; the switch that decides whether scripts
   * RUN is the device-local one above it, written through
   * `saveLocalSettings`.
   */
  private async applyHideScriptBlocks(value: boolean): Promise<void> {
    this.plugin.settings = {
      ...this.plugin.settings,
      hideScriptBlocks: value,
    };
    await this.plugin.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType(
      MARKII_PREVIEW_VIEW_TYPE,
    )) {
      if (leaf.view instanceof MarkiiPreviewView) {
        leaf.view.applyScriptBlockVisibility();
      }
    }
  }

  /**
   * Writes the inline-Reading-view preference and re-renders every open
   * `.mk.md` note that is currently showing Reading view, so the toggle
   * changes what a reader is looking at right away rather than only on the
   * next time the note is opened. `MarkdownView.previewMode` is Reading
   * view's own preview surface regardless of the plugin: calling its
   * `rerender(true)` re-runs the registered post processors, this one
   * (`src/reading-view.ts`) included, which reads the setting fresh.
   */
  private async applyInlineReadingView(value: boolean): Promise<void> {
    this.plugin.settings = {
      ...this.plugin.settings,
      inlineReadingView: value,
    };
    await this.plugin.saveSettings();
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        view.previewMode.rerender(true);
      }
    }
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
