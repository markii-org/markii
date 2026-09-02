import { existsSync } from 'node:fs';
import { readFile as nodeReadFile, rm as nodeRm } from 'node:fs/promises';
import {
  FileSystemAdapter,
  MarkdownView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
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
  DEFAULT_PACK_TRUST_LIST,
  PACK_TRUST_STORAGE_KEY,
  normalizePackTrustList,
  trustPack,
  untrustPack,
} from './packs/pack-trust.js';
import type { PackTrustList } from './packs/pack-trust.js';
import {
  createNodePackDirLister,
  selectLoadablePackFolders,
} from './packs/installed-packs.js';
import type { LoadablePackFolder } from './packs/installed-packs.js';
import {
  createBrowserWorkerSetup,
  type BrowserWorkerSetup,
} from './run/browser-worker.js';
import {
  buildComponentCatalog,
  componentSkeleton,
  createNetProvider,
  MARK_EXTENSION,
  offsetToLineColumn,
  readPersistedValues,
} from '@markii/host';
import type {
  CascadeLinkResolver,
  DiscoveredPack,
  ExportImageReader,
  InsertableComponent,
} from '@markii/host';
import { discoverConfiguredPacks } from './packs/discover-configured-packs.js';
import {
  bundledDiscoveredPacks,
  bundledPackAssets,
} from './packs/bundled-packs.js';
import { pickInsertableComponent } from './insert-modals.js';
import { fenceEditorChanges } from './fence-edits.js';
import { MarkiiCompletionSuggest } from './complete-suggest.js';
import {
  NO_ACTIVE_NOTE_NOTICE,
  exportDiagnosticLines,
  exportNoteAsHtml,
  exportNoteAsPdf,
  exportNoticeText,
} from './export-note.js';
import type { NoteExportFs, NoteExportOutcome } from './export-note.js';
import { createElectronHtmlToPdf } from './export/html-to-pdf.js';
import { renderNoteBodyForExport } from './export/render-body.js';
import { createVaultImageReader } from './export/export-images.js';
import type { VaultImageReaderDeps } from './export/export-images.js';
import {
  exportCascadeDiagnosticLines,
  exportCascadeNoticeText,
  exportNoteCascade,
} from './export/cascade-export.js';
import type { CascadeExportOutcome } from './export/cascade-export.js';
import { createLocalStorageMemento } from './run/local-storage-memento.js';
import {
  SCRIPTS_DISABLED_CONFIRMATION,
  SCRIPTS_ENABLED_CONFIRMATION,
} from './script-execution.js';
import type { Registry } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';
import { loadPackContext } from './packs/pack-context.js';
import type { PackContext } from './packs/pack-context.js';
import {
  formatPackDiagnosticLines,
  notEnabledPackLine,
  packCollisionNotice,
  packEnabledNotice,
  packLoadFailureNotice,
  packRemoveFolderFailedNotice,
  packRemovedNotice,
  skippedPackCount,
} from './packs/pack-diagnostics.js';
import {
  applyPackStylesheets,
  removePackStylesheets,
} from './packs/pack-styles.js';
import { registerReadingView } from './reading-view.js';
import { pickPackArchiveFile } from './pick-folder.js';
import { confirmModal } from './run-modals.js';
import { createNodeArchiveExtractFs } from './packs/archive-packs.js';
import {
  installConsentMessage,
  installPackDiagnosticLines,
  installPackFromArchive,
  installPackNoticeText,
  installReplaceConfirmMessage,
} from './packs/install-pack.js';

/**
 * Imports `obsidian` — deliberately NOT unit-tested (Vitest cannot resolve
 * `obsidian`), per this plugin's file-scope split (see
 * `src/obsidian-import-guard.test.ts`). Every piece of logic worth testing
 * in isolation (the document -> React render, the settings shapes, the
 * worker-path resolution, the grant memento, the pack trust list) already
 * lives in plain modules; this file, `src/view.tsx`, `src/settings-tab.ts`,
 * and `src/run-modals.ts` are wiring only.
 */
export default class MarkiiPlugin extends Plugin {
  /** Cosmetic-only, vault-synced settings (`loadData`/`saveData`) — see `src/settings.ts`'s PERSISTENCE TIER note. */
  settings: MarkiiSettings = DEFAULT_SETTINGS;
  /**
   * DEVICE-LOCAL settings (`app.saveLocalStorage`/`loadLocalStorage`, NEVER
   * `saveData`) — auto-run and the scheduled-refresh interval, both of
   * which schedule execution without a click, plus the switch that turns
   * script execution off on this device entirely. See `src/local-settings.ts`'s
   * top comment for why these can never live in `settings` above.
   */
  localSettings: LocalSettings = DEFAULT_LOCAL_SETTINGS;
  /**
   * DEVICE-LOCAL (`app.saveLocalStorage`, NEVER `saveData`) — which
   * installed-pack namespaces this device trusts to load. See
   * `src/packs/pack-trust.ts`'s top comment for why: this list authorizes
   * code execution, exactly like a network grant.
   */
  packTrust: PackTrustList = DEFAULT_PACK_TRUST_LIST;
  /**
   * This plugin's currently loaded packs (docs/packs.md, AGENTS.md's Host
   * positioning: Obsidian is archive-only, no compiler) — loaded ONCE here
   * rather than once per view, so the preview pane, Reading view, export,
   * Insert Component, and directive completion all read the SAME registry
   * instead of each loading their own copy. `undefined` before the first
   * load completes; every reader treats that exactly like "no packs
   * loaded" (`readingViewRegistry`, `exportRegistryContext`), never
   * blocking on it. Refreshed by `reloadPacks` (install, remove, enable,
   * the "Reload Markii packs" command, and once on plugin load).
   */
  packContext: PackContext | undefined;
  /** Every namespace present on disk under `packs/` but not trusted on this device (`./packs/installed-packs.ts`) — the settings tab's "present, not enabled" rows. Refreshed alongside `packContext`. */
  notEnabledPackNamespaces: readonly string[] = [];
  /**
   * The Web Worker isolate this host runs scripts in, plus the blob URLs it
   * owns. The worker's bytes ship base64-embedded inside `main.js` itself
   * (`src/run/embedded-assets.ts`, filled in at build time — see
   * `esbuild.options.mjs`'s `embed-runtime-assets` plugin) rather than as
   * files next to it, so Obsidian's single-file install channels (BRAT,
   * later the community catalogue) end up with a working Run path too.
   * `undefined` means the embed is empty — a dev tree before a build has
   * run — which the run path reports rather than throwing over.
   *
   * A Web Worker rather than the `node:worker_threads` one `@markii/host`
   * defaults to, because Obsidian's Electron renderer supports neither
   * worker threads nor forking a Node child — see
   * `src/run/browser-worker.ts`.
   */
  browserWorker: BrowserWorkerSetup | undefined;

  /**
   * The directive-autocompletion catalog (every standard component plus
   * every loaded pack's components), refreshed alongside `packContext` by
   * `reloadPacks` rather than rebuilt per keystroke, since
   * `MarkiiCompletionSuggest`'s `onTrigger` runs on every keypress in a
   * `.mk.md` note. Starts empty so the suggester has a well-formed, if
   * temporarily incomplete, catalog before the first load settles.
   */
  private completionCatalog: readonly InsertableComponent[] = [];

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.loadLocalSettings();
    this.loadPackTrust();
    this.browserWorker = this.createBrowserWorker();
    // Not awaited: pack loading touches the filesystem, and every reader
    // of `packContext`/`completionCatalog` already treats "not loaded yet"
    // the same as "no packs" rather than blocking on it.
    void this.reloadPacks(false);

    this.registerView(
      MARKII_PREVIEW_VIEW_TYPE,
      (leaf) => new MarkiiPreviewView(leaf, this),
    );

    this.addSettingTab(new MarkiiSettingTab(this.app, this));

    // Reading view (GitHub issue #36): renders a `.mk.md` note's components
    // inline, wherever Obsidian already shows the note read-only, rather
    // than only in the separate Markii Preview pane. `.mk.md` only, and
    // gated by `settings.inlineReadingView` (checked inside the processor
    // itself, so a later settings-tab toggle takes effect on the note's
    // next render pass without re-registering anything here).
    registerReadingView(this);

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

    // Without these, the only way to reach the plugin is the command
    // palette. The ribbon icon is always visible; the header action appears
    // only on a `.mk.md` note, right where the reader is already looking.
    this.addRibbonIcon('layout-template', 'Open Markii Preview', () => {
      void this.openPreview();
    });

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.addHeaderActions();
      }),
    );
    this.addHeaderActions();

    this.addCommand({
      id: 'insert-markii-component',
      name: 'Insert Markii component',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.insertComponent(view);
        return true;
      },
    });

    this.registerEditorSuggest(
      new MarkiiCompletionSuggest(this.app, () => this.completionCatalog),
    );

    // A plain `callback`, not a `checkCallback`: an export command that
    // simply vanishes when the wrong file is focused is the mute failure
    // AGENTS.md warns about. These stay visible and say what to open.
    this.addCommand({
      id: 'export-markii-note-html',
      name: 'Export Markii note as HTML',
      callback: () => {
        void this.exportActiveNote('html');
      },
    });

    this.addCommand({
      id: 'export-markii-note-pdf',
      name: 'Export Markii note as PDF',
      callback: () => {
        void this.exportActiveNote('pdf');
      },
    });

    this.addCommand({
      id: 'export-markii-note-html-cascade',
      name: 'Export Markii note as HTML cascade',
      callback: () => {
        void this.exportActiveCascade();
      },
    });

    // GitHub issue #34: the device-local off switch, reachable without
    // opening the settings tab. Mirrors the settings tab's own toggle
    // rather than duplicating the decision: both write the same
    // `scriptsDisabled` key through `saveLocalSettings`, and the gate that
    // reads it lives in one place, `src/view.tsx`'s `runScripts`.
    this.addCommand({
      id: 'toggle-markii-script-execution',
      name: 'Toggle Markii script execution',
      callback: () => {
        const next = !this.localSettings.scriptsDisabled;
        this.saveLocalSettings({
          ...this.localSettings,
          scriptsDisabled: next,
        });
        new Notice(
          next ? SCRIPTS_DISABLED_CONFIRMATION : SCRIPTS_ENABLED_CONFIRMATION,
        );
      },
    });

    this.addCommand({
      id: 'install-markii-pack-from-file',
      name: 'Install Markii pack from file',
      callback: () => {
        void this.installPackFromFile();
      },
    });

    this.addCommand({
      id: 'reload-markii-packs',
      name: 'Reload Markii packs',
      callback: () => {
        void this.reloadPacks(true);
      },
    });

    this.addCommand({
      id: 'show-markii-diagnostics',
      name: 'Show Markii diagnostics',
      callback: () => {
        this.logPackDiagnostics();
        this.activePreviewView()?.logRunDiagnostics();
        new Notice('Markii: diagnostics printed to the console.');
      },
    });
  }

  /** The active `.mk.md` file, or `undefined` — what both export commands act on. */
  private activeMarkFile(): TFile | undefined {
    const file = this.app.workspace.getActiveFile();
    return file && file.path.endsWith(MARK_EXTENSION) ? file : undefined;
  }

  /** The vault writes an export needs, backed by the vault adapter so Obsidian indexes what is written and it lands inside the vault, never outside it. */
  private exportFs(): NoteExportFs {
    const adapter = this.app.vault.adapter;
    return {
      writeText: (path, contents) => adapter.write(path, contents),
      writeBinary: (path, data) =>
        adapter.writeBinary(
          path,
          data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer,
        ),
    };
  }

  /**
   * The `ExportImageReader` for one note (GitHub issue #28 slice 3, part
   * 1): resolves an `<img src>` the way Obsidian's own preview resolves
   * one, `app.metadataCache.getFirstLinkpathDest` first and a plain
   * vault-relative path second, then reads it through the vault adapter.
   * Every decision beyond these four one-line calls lives in
   * `./export/export-images.ts`, which is what `src/export/
   * export-images.test.ts` exercises against a fake vault.
   *
   * THE JAIL. The vault adapter Obsidian hands this plugin is jailed to
   * the vault by construction, so a resolved path can never read outside
   * it; there is no separate jail to add here.
   */
  private exportImageReader(notePath: string): ExportImageReader {
    const adapter = this.app.vault.adapter;
    const deps: VaultImageReaderDeps = {
      linkpathDest: (src, from) =>
        this.app.metadataCache.getFirstLinkpathDest(src, from)?.path,
      pathExists: (path) => adapter.exists(path),
      statSize: async (path) => (await adapter.stat(path))?.size,
      readBinary: async (path) =>
        new Uint8Array(await adapter.readBinary(path)),
    };
    return createVaultImageReader(notePath, deps);
  }

  /**
   * The note's own folder as an absolute filesystem path, for the PDF
   * printer: the printed page has to resolve the note's relative image
   * sources exactly as the exported HTML does, so it is printed from the
   * note's folder. `undefined` when the vault has no filesystem path, which
   * the printer reports as PDF being unavailable rather than printing a
   * page with broken images.
   */
  private noteFolderPath(file: TFile): string | undefined {
    const base = this.vaultBasePath();
    if (base === undefined) return undefined;
    const separator = file.path.lastIndexOf('/');
    const folder = separator === -1 ? '' : file.path.slice(0, separator);
    return folder ? path.join(base, ...folder.split('/')) : base;
  }

  /**
   * The engine an export renders through (GitHub issue #28 slice 2): this
   * plugin's currently loaded pack registry, when it has any packs, or
   * `undefined` for "render statically" (no packs loaded at all). Unlike
   * before centralizing pack loading onto the plugin, there is no
   * "on-demand load" branch any more — `packContext` is always the one,
   * shared load `reloadPacks` maintains, so an export simply reads it.
   */
  private exportRegistryContext():
    | {
        registry: Registry;
        stylesheets: PackContext['stylesheets'];
        packCount: number;
      }
    | undefined {
    if (!this.packContext || this.packContext.packs.length === 0) {
      return undefined;
    }
    return {
      registry: this.packContext.registry,
      stylesheets: this.packContext.stylesheets,
      packCount: this.packContext.packs.length,
    };
  }

  /**
   * The two export commands (GitHub issue #28). Wiring only: every
   * decision, and every user-facing string, lives in `./export-note.ts`,
   * the one Electron-touching piece lives in `./export/html-to-pdf.ts`,
   * and the React render itself lives in `./export/render-body.ts`.
   *
   * VALUES. The note's last run is baked into the file, read from the same
   * device-local store the preview rehydrates from. Deliberately not marked
   * stale the way a reopened preview is: a static file has no re-run to be
   * stale against, and a page of stale markers would misreport a snapshot
   * as a live view that has fallen behind. A note that has never been run
   * exports with its standard empty states, and the notice says so.
   *
   * PACK COMPONENTS (slice 2). When `exportRegistryContext` finds a loaded
   * pack registry, the export renders through this host's own React
   * renderer with that merged registry, so a pack directive comes out as
   * the real component, with the loaded packs' stylesheets embedded in the
   * file. With no packs loaded, the export renders through `@markii/html`,
   * the static string engine, and a pack directive would come out as that
   * engine's ordinary unknown-component fallback — moot here, since a
   * pack-free note has no pack directive to fall back on, and this is the
   * documented, non-degraded case, so it is never reported as a failure.
   *
   * Both surfaces, always (AGENTS.md's "clean is not silent"): a short
   * `Notice`, and the full detail on the console, which is this host's
   * designated diagnostics surface.
   */
  /**
   * The HTML export, reachable from the preview's own header
   * (`src/view.tsx`'s `onOpen`) as well as the palette. A thin public
   * wrapper so the view triggers exactly the command's own handler rather
   * than growing a second copy of the export flow.
   */
  exportActiveNoteAsHtml(): Promise<void> {
    return this.exportActiveNote('html');
  }

  private async exportActiveNote(format: 'html' | 'pdf'): Promise<void> {
    const file = this.activeMarkFile();
    if (!file) {
      new Notice(NO_ACTIVE_NOTE_NOTICE);
      return;
    }

    let outcome: NoteExportOutcome;
    try {
      const text = await this.app.vault.cachedRead(file);
      const memento = createLocalStorageMemento(
        (key) => this.app.loadLocalStorage(key),
        (key, value) => {
          this.app.saveLocalStorage(key, value);
        },
      );
      const values = readPersistedValues(memento, file.path);
      const packContext = this.exportRegistryContext();
      const request = {
        notePath: file.path,
        text,
        values,
        fs: this.exportFs(),
        embedImages: this.exportImageReader(file.path),
        ...(packContext
          ? {
              renderBody: renderNoteBodyForExport(packContext.registry),
              packStylesheets: packContext.stylesheets,
              packCount: packContext.packCount,
            }
          : { staticReason: 'no-packs' as const }),
      };
      outcome =
        format === 'html'
          ? await exportNoteAsHtml(request)
          : await exportNoteAsPdf({
              ...request,
              htmlToPdf: createElectronHtmlToPdf(),
              baseDir: this.noteFolderPath(file),
            });
    } catch (error) {
      outcome = {
        kind: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    for (const line of exportDiagnosticLines(outcome)) {
      if (outcome.kind === 'html' || outcome.kind === 'pdf') {
        console.info(`[markii] ${line}`);
      } else {
        console.error(`[markii] ${line}`);
      }
    }
    new Notice(exportNoticeText(outcome));
  }

  /**
   * Reads one note's text by its vault-relative path, for
   * `exportActiveCascade`'s `CascadeNoteReader`. `walkNoteCascade`
   * (`@markii/host`) treats a path that does not resolve to a real note
   * file the same as one it could not read, so returning `undefined` for
   * anything that is not a `TFile` is enough; no separate check is needed
   * here.
   */
  private readNoteText = async (path: string): Promise<string | undefined> => {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return undefined;
    return this.app.vault.cachedRead(file);
  };

  /**
   * The cascade command's link resolver (GitHub issue #28 slice 3, part
   * 2): `app.metadataCache.getFirstLinkpathDest`, the same resolution
   * Obsidian's own preview uses, accepting only a result that names a
   * note file this host can export, `.mk.md` or `.md`. Anything else, a
   * link to a PDF, an image, or a note outside the vault, resolves to
   * `undefined` so the walk leaves it exactly as written.
   */
  private cascadeLinkResolver(): CascadeLinkResolver {
    return (link, fromNotePath) => {
      const file = this.app.metadataCache.getFirstLinkpathDest(
        link.path,
        fromNotePath,
      );
      if (!file) return undefined;
      return file.path.toLowerCase().endsWith('.md') ? file.path : undefined;
    };
  }

  /**
   * The "Export Markii note as HTML cascade" command (GitHub issue #28
   * slice 3, part 2). Wiring only: the walk, the archive, and every
   * user-facing string live in `./export/cascade-export.ts`; this method
   * supplies the vault-touching seams that module cannot import for
   * itself, `readNoteText`, `cascadeLinkResolver`, the persisted-values
   * reader, and one `exportImageReader` per note reached.
   *
   * PDF is deliberately not offered here; a cascade PDF is issue #29.
   */
  private async exportActiveCascade(): Promise<void> {
    const file = this.activeMarkFile();
    if (!file) {
      new Notice(NO_ACTIVE_NOTE_NOTICE);
      return;
    }

    let outcome: CascadeExportOutcome;
    try {
      const memento = createLocalStorageMemento(
        (key) => this.app.loadLocalStorage(key),
        (key, value) => {
          this.app.saveLocalStorage(key, value);
        },
      );
      const packContext = this.exportRegistryContext();
      outcome = await exportNoteCascade({
        rootPath: file.path,
        readNote: this.readNoteText,
        resolveLink: this.cascadeLinkResolver(),
        readValues: (path) => readPersistedValues(memento, path),
        fs: this.exportFs(),
        embedImagesFor: (path) => this.exportImageReader(path),
        ...(packContext
          ? {
              renderBody: renderNoteBodyForExport(packContext.registry),
              packStylesheets: packContext.stylesheets,
              packCount: packContext.packCount,
            }
          : { staticReason: 'no-packs' as const }),
      });
    } catch (error) {
      outcome = {
        kind: 'failed',
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    for (const line of exportCascadeDiagnosticLines(outcome)) {
      if (outcome.kind === 'cascade') {
        console.info(`[markii] ${line}`);
      } else {
        console.error(`[markii] ${line}`);
      }
    }
    new Notice(exportCascadeNoticeText(outcome));
  }

  /**
   * Puts a Markii button in the header of the `.mk.md` note being edited,
   * so the preview is reachable without the command palette. Obsidian
   * re-creates a view's header actions when the leaf changes, so this runs
   * on every `active-leaf-change`; the guard class keeps a repeated call
   * from stacking duplicate icons onto a header that survived.
   */
  private addHeaderActions(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;
    if (!view.file?.path.endsWith('.mk.md')) return;

    const marker = 'markii-header-action';
    if (view.containerEl.querySelector(`.${marker}`)) return;

    const preview = view.addAction(
      'layout-template',
      'Open Markii Preview',
      () => {
        void this.openPreview();
      },
    );
    preview.addClass(marker);
    // Run deliberately does NOT go here. It needs an open preview to act
    // on, so from a source editor it could only ever scold the user for
    // not having one; it lives in the preview's own header instead
    // (`src/view.tsx`'s `onOpen`), which is where a reader is when they
    // want to re-run a note.
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
   * The registry `src/reading-view.ts` renders a note's components with:
   * this plugin's currently loaded pack registry, or the plain standard
   * set before the first load completes / when nothing is loaded. A note
   * whose packs are not (yet) loaded still renders fully: its pack
   * directives fall back to the standard unknown-component box, per
   * architecture rule 3.
   */
  readingViewRegistry(): Registry {
    return this.packContext?.registry ?? defaultRegistry;
  }

  /**
   * The "Insert Markii component" command (GitHub issue #17, slice 1):
   * offers every standard component plus every loaded pack's components,
   * and inserts the chosen one's directive skeleton at the cursor. Reuses
   * `completionCatalog` (kept fresh by `reloadPacks`) rather than
   * rediscovering packs on every invocation — packs are loaded once now,
   * not per view or per command.
   */
  private async insertComponent(view: MarkdownView): Promise<void> {
    const editor = view.editor;

    const chosen = await pickInsertableComponent(
      this.app,
      this.completionCatalog,
    );
    if (!chosen) return; // dismissed

    const skeleton = componentSkeleton(
      chosen.directiveName,
      chosen.kind,
      chosen.requiredAttributes,
    );
    // `'from'`, not the default head: `replaceSelection` writes starting at
    // the selection's START, so anchoring the cursor math anywhere else is
    // wrong whenever text is selected (and for a selection made backwards,
    // the head IS the earlier position). Mirrors the VS Code command.
    const insertPosition = editor.getCursor('from');

    // Fence auto-extension: nesting a container inside a container needs
    // the OUTER pair to carry more colons. The enclosing fences grow in
    // the SAME transaction as the insertion, so the whole thing is one
    // undo step. Quiet by contract: an ambiguous or unpaired document
    // yields no changes and the insertion proceeds as it did before.
    const fenceChanges = fenceEditorChanges(
      editor.getValue(),
      insertPosition.line,
      skeleton.text,
    );

    if (fenceChanges.length === 0) {
      editor.replaceSelection(skeleton.text);
    } else {
      editor.transaction({
        changes: [
          ...fenceChanges.map((change) => ({
            from: { ...change.from },
            to: { ...change.to },
            text: change.text,
          })),
          {
            from: insertPosition,
            to: editor.getCursor('to'),
            text: skeleton.text,
          },
        ],
      });
    }

    const cursor = offsetToLineColumn(skeleton.text, skeleton.cursorOffset);
    const cursorPosition =
      cursor.line === 0
        ? { line: insertPosition.line, ch: insertPosition.ch + cursor.column }
        : { line: insertPosition.line + cursor.line, ch: cursor.column };
    editor.setCursor(cursorPosition);
  }

  /**
   * This plugin's own on-disk folder — a REAL directory inside the vault
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
   * The vault's own base path. Desktop-only, same as `pluginDir` above.
   */
  vaultBasePath(): string | undefined {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter
      ? adapter.getBasePath()
      : undefined;
  }

  /**
   * This plugin's own installed-pack store: one subdirectory per namespace,
   * under the plugin's own on-disk folder, never the workspace, never a
   * folder the user chose (AGENTS.md's cleanliness rule). "Install Markii
   * pack from file" (`./installPackFromFile`) writes here; `reloadPacks`
   * reads its immediate subdirectories. Named `packs`, not the earlier
   * `installed-packs`: with the user-managed pack-folder list removed,
   * this is now the only place packs live.
   */
  private installedPacksDir(): string | undefined {
    const dir = this.pluginDir();
    return dir ? path.join(dir, 'packs') : undefined;
  }

  /**
   * Every namespace on disk under `installedPacksDir()`, split into
   * loadable (trusted on this device) and present-but-not-enabled
   * (`./packs/installed-packs.ts`'s pure `selectLoadablePackFolders`).
   * `[]`/`[]` when the plugin has no filesystem-backed directory at all.
   */
  private installedPackFolders(): {
    readonly loadable: readonly LoadablePackFolder[];
    readonly notEnabled: readonly string[];
  } {
    const installRoot = this.installedPacksDir();
    if (installRoot === undefined) return { loadable: [], notEnabled: [] };
    const onDisk = createNodePackDirLister()(installRoot);
    return selectLoadablePackFolders(installRoot, onDisk, this.packTrust);
  }

  /** Every namespace a bundled pack already claims — an install or an enable naming one of these is refused/moot, since the bundled pack always wins that namespace (docs/packs.md). */
  private bundledNamespaces(): ReadonlySet<string> {
    return new Set(bundledDiscoveredPacks().map((pack) => pack.manifest.name));
  }

  /**
   * Reads an installed pack's declared `version`, if it has one — used to
   * populate the trust list's optional version field at install and
   * enable time. Never throws: a missing or malformed `pack.json` simply
   * yields `undefined`, matching every other pack-loading step's
   * "degrade, don't fail" posture.
   */
  private async readInstalledPackVersion(
    installedDir: string,
  ): Promise<string | undefined> {
    try {
      const text = await nodeReadFile(
        path.join(installedDir, 'pack.json'),
        'utf8',
      );
      const parsed = JSON.parse(text) as { version?: unknown };
      return typeof parsed.version === 'string' ? parsed.version : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Loads this device's installed, trusted packs (plus the bundled set)
   * into `packContext`, swapping in their stylesheets — removing the
   * previous load's first, so a reload never leaks a stale pack's CSS
   * (AGENTS.md's cleanliness rule). Never throws: `loadPackContext`
   * already degrades quietly to "this pack didn't load, here's why."
   */
  private async loadPacks(): Promise<void> {
    if (this.packContext) {
      removePackStylesheets(
        document,
        this.packContext.stylesheets.map((sheet) => sheet.namespace),
      );
    }
    const { loadable, notEnabled } = this.installedPackFolders();
    this.notEnabledPackNamespaces = notEnabled;

    const context = await loadPackContext(
      loadable.map((entry) => entry.folder),
      defaultRegistry,
      { bundledPacks: bundledPackAssets() },
    );
    this.packContext = context;
    applyPackStylesheets(document, context.stylesheets);
  }

  /**
   * Rebuilds `completionCatalog`: every loaded pack's manifest (a cheap,
   * eval-free discovery — `./packs/discover-configured-packs.ts` — rather
   * than reusing `packContext`, so this catalog stays correct even for a
   * pack that is discoverable but whose script failed to evaluate) plus
   * the standard set, the same catalog `insertComponent` and directive
   * completion (`src/complete-suggest.ts`) both read. Never throws:
   * `discoverConfiguredPacks` already degrades quietly.
   */
  private async refreshCompletionCatalog(): Promise<void> {
    const { loadable } = this.installedPackFolders();
    let packs: readonly DiscoveredPack[] = [];
    try {
      packs = await discoverConfiguredPacks(
        loadable.map((entry) => entry.folder),
      );
    } catch {
      packs = [];
    }
    this.completionCatalog = buildComponentCatalog([
      ...bundledDiscoveredPacks(),
      ...packs,
    ]);
  }

  /**
   * Writes this pack load's diagnostic lines (`src/packs/pack-diagnostics.ts`)
   * to the console — one line per successfully loaded pack, one per skipped
   * folder with its reason, one per present-but-not-enabled namespace, plus
   * any registration warnings. AGENTS.md's cleanliness principle: "every
   * failure needs a full diagnostic somewhere a user can find it." Obsidian
   * has no output channel, so `console` is that "somewhere" (paired with
   * `Notice` for failures a user must act on). Public so "Show Markii
   * diagnostics" can call it without requiring an open preview — pack
   * loading no longer belongs to any one view.
   */
  logPackDiagnostics(): void {
    console.log(`[markii] pack load at ${new Date().toISOString()}`);
    const lines = this.packContext
      ? formatPackDiagnosticLines(this.packContext)
      : [];
    if (lines.length === 0 && this.notEnabledPackNamespaces.length === 0) {
      console.log('[markii]   no packs installed');
    }
    for (const line of lines) {
      console.log(`[markii]   ${line}`);
    }
    for (const namespace of this.notEnabledPackNamespaces) {
      console.log(`[markii]   ${notEnabledPackLine(namespace)}`);
    }
  }

  /** A `Notice` for pack failures a user must act on — a skipped folder, or two packs sharing a namespace. All wording lives in `./packs/pack-diagnostics.ts`. */
  private notifyPackFailures(): void {
    if (!this.packContext) return;
    const failedCount = skippedPackCount(this.packContext);
    if (failedCount > 0) {
      new Notice(packLoadFailureNotice(failedCount));
    }
    if (this.packContext.registrationCollisions.length > 0) {
      new Notice(packCollisionNotice(this.packContext.registrationCollisions));
    }
  }

  /** Re-renders every open Markii surface with the current `packContext`: every open Markii Preview pane, and every open markdown leaf currently showing Reading view (`previewMode.rerender(true)`, the way `settings-tab.ts`'s `applyInlineReadingView` already does). Used after install, remove, enable, and the "Reload Markii packs" command. */
  private reloadOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(
      MARKII_PREVIEW_VIEW_TYPE,
    )) {
      if (leaf.view instanceof MarkiiPreviewView) {
        void leaf.view.refresh();
      }
    }
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        view.previewMode.rerender(true);
      }
    }
  }

  /**
   * Reloads this device's installed packs and re-renders every open Markii
   * view. Used on plugin load, after install/remove/enable, and by the
   * "Reload Markii packs" command. `showNotice` is true only for that
   * explicit manual command; install/remove/enable already show their own
   * outcome notice, and the load-on-startup call stays quiet on success
   * (failures still reach both of AGENTS.md's two homes either way).
   */
  async reloadPacks(showNotice: boolean): Promise<void> {
    await this.loadPacks();
    await this.refreshCompletionCatalog();
    this.logPackDiagnostics();
    this.notifyPackFailures();
    this.reloadOpenViews();
    if (showNotice) {
      new Notice('Markii: packs reloaded.');
    }
  }

  /**
   * The "Install Markii pack from file" command (AGENTS.md's Host
   * positioning: the ONLY way a pack enters this plugin). Picks a `.mkp`
   * archive, validates it, refuses one whose namespace is already a
   * bundled pack's, asks consent to run its code, asks before replacing an
   * already-installed pack of the same namespace, and unzips it into
   * `installedPacksDir()`. Every decision and every user-facing string
   * lives in `./packs/install-pack.ts`; this method is wiring only. A
   * successful install adds the namespace to this device's trust list and
   * reloads every open view immediately — no "reopen the preview" step.
   */
  private async installPackFromFile(): Promise<void> {
    const archivePath = await pickPackArchiveFile();
    if (archivePath === undefined) return; // cancelled, or no picker available

    const installRoot = this.installedPacksDir();
    if (installRoot === undefined) {
      new Notice('Markii: could not find a folder to install the pack into.');
      console.error(
        '[markii] Install Markii pack from file: no plugin directory is available on this install.',
      );
      return;
    }

    let archiveBytes: Uint8Array;
    try {
      archiveBytes = new Uint8Array(await nodeReadFile(archivePath));
    } catch (err) {
      new Notice(
        `Markii: could not read "${archivePath}". Open the Markii diagnostics for details.`,
      );
      console.error(
        `[markii] Install Markii pack from file could not read "${archivePath}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    const outcome = await installPackFromArchive({
      archiveBytes,
      archivePath,
      installRoot,
      exists: async (dir) => existsSync(dir),
      extractFs: createNodeArchiveExtractFs(),
      confirmConsent: (name) =>
        confirmModal(this.app, installConsentMessage(name)),
      confirmReplace: (name) =>
        confirmModal(this.app, installReplaceConfirmMessage(name)),
      bundledNamespaces: this.bundledNamespaces(),
    });

    for (const line of installPackDiagnosticLines(outcome, archivePath)) {
      console.info(`[markii] ${line}`);
    }
    new Notice(installPackNoticeText(outcome, archivePath));

    if (outcome.kind === 'installed') {
      const version = await this.readInstalledPackVersion(outcome.installedDir);
      this.savePackTrust(trustPack(this.packTrust, outcome.packName, version));
      await this.reloadPacks(false);
    }
  }

  /**
   * The settings tab's "Enable" control for a pack folder that is present
   * on disk but not yet trusted on this device (arrived via Sync, or a
   * hand copy). Asks the SAME consent prompt "Install Markii pack from
   * file" asks, since enabling it is exactly as consequential: its code
   * will run inside the preview from this point on.
   */
  async enablePresentPack(namespace: string): Promise<void> {
    const consented = await confirmModal(
      this.app,
      installConsentMessage(namespace),
    );
    if (!consented) return;

    const installRoot = this.installedPacksDir();
    if (installRoot === undefined) return;
    const version = await this.readInstalledPackVersion(
      path.join(installRoot, namespace),
    );
    this.savePackTrust(trustPack(this.packTrust, namespace, version));
    await this.reloadPacks(false);
    new Notice(packEnabledNotice(namespace));
  }

  /**
   * The settings tab's "Remove" control for an installed pack: deletes its
   * folder and its trust entry, then reloads immediately. Never removes a
   * bundled pack — the settings tab never offers this control for one.
   */
  async removeInstalledPack(namespace: string): Promise<void> {
    const installRoot = this.installedPacksDir();
    if (installRoot === undefined) return;
    const dir = path.join(installRoot, namespace);
    let folderDeleted = true;
    try {
      await nodeRm(dir, { recursive: true, force: true });
    } catch (err) {
      folderDeleted = false;
      console.error(
        `[markii] could not remove pack folder "${dir}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    // The trust entry goes either way: whatever happened to the folder,
    // this device has withdrawn its authorization, so the pack stops
    // loading on the reload below. What differs is what the user is told.
    this.savePackTrust(untrustPack(this.packTrust, namespace));
    await this.reloadPacks(false);
    new Notice(
      folderDeleted
        ? packRemovedNotice(namespace)
        : packRemoveFolderFailedNotice(namespace),
    );
  }

  /**
   * Frees the blob URLs the Web Worker isolate holds. A blob URL pins its
   * bytes in memory until revoked, and one of them is the worker bundle
   * decoded from `main.js`'s own embed, so leaking them across a plugin
   * reload is not a rounding error.
   */
  override onunload(): void {
    this.browserWorker?.dispose();
  }

  private createBrowserWorker(): BrowserWorkerSetup | undefined {
    // The pinned provider runs HERE, in the renderer, because the isolate
    // is a Web Worker with no `node:dns` to pin with. It is the same
    // provider the VS Code extension runs inside its worker thread, so the
    // DNS-rebinding protection (issue #10) is unchanged by the move; what
    // changes is that the sandbox can no longer reach a network stack at
    // all. The plain-Error denial is deliberate: the brand that classifies
    // a refusal is re-applied inside the worker, which is where
    // `@markii/lua` lives (see `@markii/host`'s `net-bridge.ts`).
    return createBrowserWorkerSetup((allowlist, maxFetchBytes, policy) =>
      createNetProvider(
        allowlist,
        maxFetchBytes,
        policy as Parameters<typeof createNetProvider>[2],
        (message) => new Error(message),
      ),
    );
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
   * DEVICE-LOCAL settings (auto-run, the scheduled-refresh interval, the
   * script-execution switch) —
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
   * DEVICE-LOCAL pack trust list (`src/packs/pack-trust.ts`'s top comment)
   * — `app.loadLocalStorage`/`app.saveLocalStorage`, never `loadData`/
   * `saveData`, for the same reason `loadLocalSettings`/`saveLocalSettings`
   * above use it: this authorizes code execution.
   */
  loadPackTrust(): void {
    this.packTrust = normalizePackTrustList(
      this.app.loadLocalStorage(PACK_TRUST_STORAGE_KEY),
    );
  }

  savePackTrust(next: PackTrustList): void {
    this.packTrust = next;
    this.app.saveLocalStorage(PACK_TRUST_STORAGE_KEY, next);
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
