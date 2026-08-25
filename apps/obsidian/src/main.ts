import { existsSync } from 'node:fs';
import { FileSystemAdapter, Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import * as path from 'node:path';
import { MARKII_PREVIEW_VIEW_TYPE, MarkiiPreviewView } from './view.js';
import { MarkiiSettingTab } from './settings-tab.js';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js';
import type { MarkiiSettings } from './settings.js';
import {
  DEFAULT_LOCAL_SETTINGS,
  LOCAL_SETTINGS_STORAGE_KEY,
  normalizeLocalSettings,
} from './local-settings.js';
import type { LocalSettings } from './local-settings.js';
import {
  DEFAULT_PACK_SETTINGS,
  PACK_SETTINGS_STORAGE_KEY,
  normalizePackSettings,
} from './packs/pack-settings.js';
import type { PackSettings } from './packs/pack-settings.js';
import { resolveWorkerPath } from './run/worker-path.js';

/**
 * Imports `obsidian` — deliberately NOT unit-tested (Vitest cannot resolve
 * `obsidian`), per this plugin's file-scope split (see
 * `src/obsidian-import-guard.test.ts`). Every piece of logic worth testing
 * in isolation (the document -> React render, the settings shapes, the
 * worker-path resolution, the grant memento) already lives in plain
 * modules; this file, `src/view.tsx`, `src/settings-tab.ts`, and
 * `src/run-modals.ts` are wiring only.
 */
export default class MarkiiPlugin extends Plugin {
  /** Cosmetic-only, vault-synced settings (`loadData`/`saveData`) — see `src/settings.ts`'s PERSISTENCE TIER note. */
  settings: MarkiiSettings = DEFAULT_SETTINGS;
  /**
   * DEVICE-LOCAL settings (`app.saveLocalStorage`/`loadLocalStorage`, NEVER
   * `saveData`) — auto-run and the scheduled-refresh interval, both of
   * which schedule execution without a click. See `src/local-settings.ts`'s
   * top comment for why these can never live in `settings` above.
   */
  localSettings: LocalSettings = DEFAULT_LOCAL_SETTINGS;
  /**
   * DEVICE-LOCAL (`app.saveLocalStorage`, NEVER `saveData`) — the list of
   * folders this device trusts as installed component packs. See
   * `src/packs/pack-settings.ts`'s top comment for why: this setting
   * authorizes code execution, exactly like a network grant.
   */
  packSettings: PackSettings = DEFAULT_PACK_SETTINGS;
  /**
   * The packaged, bundled worker entry for the Run path's terminatable
   * isolate (`@markii/host`'s `spawnRun`), or `undefined` in dev before
   * `npm run build` has produced `worker.js` next to `main.js` — in which
   * case `spawnRun`'s own dev/Vitest fallback (`defaultWorkerPath`, a
   * `tsx`-run source file) is not reachable from a packaged plugin either,
   * so a `markii.runScripts` press simply fails cleanly (see
   * `src/view.tsx`'s `runScripts`) rather than silently doing nothing.
   */
  workerPath: string | undefined;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.loadLocalSettings();
    this.loadPackSettings();
    this.workerPath = this.resolveWorkerPath();

    this.registerView(
      MARKII_PREVIEW_VIEW_TYPE,
      (leaf) => new MarkiiPreviewView(leaf, this),
    );

    this.addSettingTab(new MarkiiSettingTab(this.app, this));

    this.addCommand({
      id: 'open-markii-preview',
      name: 'Open Markii Preview',
      callback: () => {
        void this.openPreview();
      },
    });

    this.addCommand({
      id: 'run-markii-scripts',
      name: 'Run Markii scripts',
      checkCallback: (checking) => {
        const view = this.activePreviewView();
        if (!view) return false;
        if (!checking) void view.runScripts('manual');
        return true;
      },
    });

    this.addCommand({
      id: 'show-markii-diagnostics',
      name: 'Show Markii diagnostics',
      callback: () => {
        const view = this.activePreviewView();
        if (!view) {
          new Notice(
            'Markii: open a preview first — diagnostics are per-preview.',
          );
          return;
        }
        view.logPackDiagnostics();
        new Notice('Markii: pack diagnostics printed to the console.');
      },
    });
  }

  /**
   * The active `.mk.md` preview view, if any — used by the
   * `run-markii-scripts` command so it can be invoked from the command
   * palette regardless of which leaf currently has focus, matching
   * `activePreviewableDocument`-style discovery in the VS Code extension.
   */
  private activePreviewView(): MarkiiPreviewView | undefined {
    const leaves = this.app.workspace.getLeavesOfType(MARKII_PREVIEW_VIEW_TYPE);
    const first = leaves[0]?.view;
    return first instanceof MarkiiPreviewView ? first : undefined;
  }

  /**
   * The plugin's own on-disk folder — a REAL directory inside the vault
   * (`<vault>/.obsidian/plugins/markii/`), as opposed to this workspace's
   * source layout. `FileSystemAdapter` is desktop-only (this plugin
   * declares `isDesktopOnly: true` in `manifest.json`), so this is safe to
   * assume unconditionally.
   */
  private pluginDir(): string | undefined {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return undefined;
    return path.join(adapter.getBasePath(), this.manifest.dir ?? '');
  }

  /**
   * The vault's own base path — what a relative pack-folder setting entry
   * resolves against (`src/packs/pack-paths.ts`'s `resolvePackPaths`),
   * mirroring `apps/vscode/src/packs/resolve-pack-paths.ts`'s "resolve
   * against the open workspace folder" rule with this host's closest
   * analogue, the open vault. Desktop-only, same as `pluginDir` above.
   */
  vaultBasePath(): string | undefined {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter
      ? adapter.getBasePath()
      : undefined;
  }

  /**
   * A plugin-owned directory a pack's compiled registration script may be
   * cached under — NEVER a pack's own folder (AGENTS.md's cleanliness
   * rule). Obsidian plugins have no per-extension "global storage" outside
   * a vault the way `vscode.ExtensionContext.globalStorageUri` does, so
   * this sits under the plugin's own installed folder
   * (`<vault>/.obsidian/plugins/markii/pack-cache/`) — inside Obsidian's
   * own machinery directory, not the user's authored note tree, matching
   * the spirit of the cleanliness rule even though it is technically
   * inside the vault.
   */
  packCacheDir(): string | undefined {
    const dir = this.pluginDir();
    return dir ? path.join(dir, 'pack-cache') : undefined;
  }

  /**
   * Absolute path to a REAL, unbundled `esbuild-wasm/lib/browser.js` next
   * to the packaged plugin (`esbuild.config.mjs` copies it there — see
   * that file's doc comment), or `undefined` if not present (dev, before
   * `npm run build` has produced it this way) — `@markii/host`'s
   * `packs/pack-build.ts`'s `loadEsbuildWasm` then falls back to plain
   * `node_modules` resolution. Mirrors
   * `apps/vscode/src/preview-panel.ts`'s `esbuildBrowserModulePath`.
   */
  esbuildBrowserModulePath(): string | undefined {
    const dir = this.pluginDir();
    if (!dir) return undefined;
    const candidate = path.join(dir, 'esbuild-wasm', 'lib', 'browser.js');
    return existsSync(candidate) ? candidate : undefined;
  }

  /** Sibling of `esbuildBrowserModulePath()` — the `esbuild.wasm` binary `loadEsbuildWasm` compiles via `WebAssembly.compile`. Same fallback posture. */
  esbuildWasmBinaryPath(): string | undefined {
    const dir = this.pluginDir();
    if (!dir) return undefined;
    const candidate = path.join(dir, 'esbuild-wasm', 'esbuild.wasm');
    return existsSync(candidate) ? candidate : undefined;
  }

  private resolveWorkerPath(): string | undefined {
    const dir = this.pluginDir();
    return dir ? resolveWorkerPath(dir) : undefined;
  }

  /**
   * See the PERSISTENCE TIER note atop `src/settings.ts`: `loadData`/
   * `saveData` write into the vault (syncs/shares with it), which is fine
   * for this cosmetic placement preference and NOT fine for any future
   * setting that grants execution or network access — those need
   * `app.saveLocalStorage`/`app.loadLocalStorage` instead (see
   * `loadLocalSettings`/`saveLocalSettings` below).
   */
  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * DEVICE-LOCAL settings (auto-run, the scheduled-refresh interval) —
   * `app.loadLocalStorage`/`app.saveLocalStorage`, synchronous, and NEVER
   * routed through `loadData`/`saveData`. See `src/local-settings.ts`'s top
   * comment.
   */
  loadLocalSettings(): void {
    this.localSettings = normalizeLocalSettings(
      this.app.loadLocalStorage(LOCAL_SETTINGS_STORAGE_KEY),
    );
  }

  saveLocalSettings(next: LocalSettings): void {
    this.localSettings = next;
    this.app.saveLocalStorage(LOCAL_SETTINGS_STORAGE_KEY, next);
  }

  /**
   * DEVICE-LOCAL pack-folder setting (`src/packs/pack-settings.ts`'s top
   * comment) — `app.loadLocalStorage`/`app.saveLocalStorage`, never
   * `loadData`/`saveData`, for the same reason `loadLocalSettings`/
   * `saveLocalSettings` above use it: this authorizes code execution.
   */
  loadPackSettings(): void {
    this.packSettings = normalizePackSettings(
      this.app.loadLocalStorage(PACK_SETTINGS_STORAGE_KEY),
    );
  }

  savePackSettings(next: PackSettings): void {
    this.packSettings = next;
    this.app.saveLocalStorage(PACK_SETTINGS_STORAGE_KEY, next);
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
