import { existsSync } from 'node:fs';
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
  DEFAULT_PACK_SETTINGS,
  PACK_SETTINGS_STORAGE_KEY,
  normalizePackSettings,
} from './packs/pack-settings.js';
import type { PackSettings } from './packs/pack-settings.js';
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
  ExportImageReader,
  InsertableComponent,
} from '@markii/host';
import { discoverConfiguredPacks } from './packs/discover-configured-packs.js';
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
import { buildPackRegistrationScript } from '@markii/host';
import type { Registry } from '@markii/react';
import { defaultRegistry } from '@markii/react/components';
import { loadPackContext } from './packs/pack-context.js';
import type { PackContext } from './packs/pack-context.js';
import { createPackRegistrationBuilder } from './packs/pack-compilation.js';
import { formatPackDiagnosticLines } from './packs/pack-diagnostics.js';

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
   * which schedule execution without a click, plus the switch that turns
   * script execution off on this device entirely. See `src/local-settings.ts`'s
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
   * The directive-autocompletion catalog (GitHub issue #27, slice 3): every
   * standard component plus every configured pack's components, the same
   * pairing `insertComponent` below builds fresh on each invocation. This
   * copy is held on the plugin instance and refreshed by
   * `refreshCompletionCatalog` (on load, and again from `savePackSettings`)
   * rather than rebuilt per keystroke, since `MarkiiCompletionSuggest`'s
   * `onTrigger` runs on every keypress in a `.mk.md` note and cannot afford
   * a pack-discovery filesystem walk each time. Starts empty so the
   * suggester has a well-formed, if temporarily incomplete, catalog before
   * the first async refresh settles.
   */
  private completionCatalog: readonly InsertableComponent[] = [];

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.loadLocalSettings();
    this.loadPackSettings();
    this.browserWorker = this.createBrowserWorker();
    // Not awaited: pack discovery touches the filesystem, and the
    // completion catalog is allowed to arrive a moment after the note does
    // (`onTrigger` simply sees an empty/standard-only catalog until then)
    // rather than blocking activation on it.
    void this.refreshCompletionCatalog();

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
      id: 'show-markii-diagnostics',
      name: 'Show Markii diagnostics',
      callback: () => {
        const view = this.activePreviewView();
        if (!view) {
          new Notice(
            'Markii: diagnostics are per preview, so open a preview first.',
          );
          return;
        }
        view.logPackDiagnostics();
        new Notice('Markii: pack diagnostics printed to the console.');
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
   * open preview's already-loaded pack registry when one is open, or a
   * pack context loaded on demand when none is, so an export is
   * pack-complete without requiring a preview to be open first. Returns
   * `undefined` for "render statically": no preview is open and either no
   * pack folders are configured or the on-demand load ended up with zero
   * loaded packs, in which case the exported file is byte-identical to
   * slice 1's, which is deliberate.
   *
   * The on-demand path never injects its stylesheets into `document.head`
   * and never shows a pack `Notice` — an export only needs the registry
   * and the stylesheet text to embed, not a live preview's styling. Its
   * diagnostics still go to the console, this host's diagnostics surface,
   * and a load failure degrades to "no packs" rather than failing the
   * export command.
   */
  private async exportRegistryContext(): Promise<
    | {
        registry: Registry;
        stylesheets: PackContext['stylesheets'];
        packCount: number;
      }
    | undefined
  > {
    const preview = this.activePreviewView();
    const fromPreview = preview?.exportPackContext();
    if (fromPreview) return fromPreview;
    if (preview || this.packSettings.packFolders.length === 0) {
      return undefined;
    }

    try {
      const cacheDir = this.packCacheDir();
      const browserModulePath = this.esbuildBrowserModulePath();
      const wasmBinaryPath = this.esbuildWasmBinaryPath();
      const context = await loadPackContext(
        this.packSettings.packFolders,
        this.vaultBasePath(),
        defaultRegistry,
        {
          cacheDir,
          buildRegistrationScript:
            cacheDir === undefined
              ? undefined
              : createPackRegistrationBuilder({
                  esbuildBrowserModulePath: browserModulePath,
                  esbuildWasmBinaryPath: wasmBinaryPath,
                  compile: (pack, dir) =>
                    buildPackRegistrationScript(pack, dir, {
                      esbuildBrowserModulePath: browserModulePath,
                      esbuildWasmBinaryPath: wasmBinaryPath,
                    }),
                }),
        },
      );
      for (const line of formatPackDiagnosticLines(context)) {
        console.log(`[markii] export: ${line}`);
      }
      if (context.packs.length === 0) return undefined;
      return {
        registry: context.registry,
        stylesheets: context.stylesheets,
        packCount: context.packs.length,
      };
    } catch (error) {
      console.error('[markii] export: on-demand pack load failed', error);
      return undefined;
    }
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
      const packContext = await this.exportRegistryContext();
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
      const packContext = await this.exportRegistryContext();
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
   * The "Insert Markii component" command (`insert-markii-component`,
   * GitHub issue #17, slice 1): offers every standard component plus every
   * configured pack's components, and inserts the chosen one's directive
   * skeleton at the cursor. Every testable piece (the suggestion shape,
   * every user-facing string) lives in `./insert-component.ts`; the
   * catalog and skeleton builders are `@markii/host`'s (shared with the VS
   * Code extension). This method is wiring only — the command's
   * `checkCallback` in `onload` already guarded that an active
   * `MarkdownView` with an editor exists.
   *
   * A pack-discovery failure never blocks the command:
   * `discoverConfiguredPacks` already degrades quietly (a bad folder is
   * simply skipped, never thrown), so a caught error here still falls back
   * to the standard set alone rather than failing the whole command.
   */
  private async insertComponent(view: MarkdownView): Promise<void> {
    const editor = view.editor;

    let packs: Awaited<ReturnType<typeof discoverConfiguredPacks>> = [];
    try {
      packs = await discoverConfiguredPacks(
        this.packSettings.packFolders,
        this.vaultBasePath(),
      );
    } catch {
      packs = [];
    }

    const catalog = buildComponentCatalog(packs);
    const chosen = await pickInsertableComponent(this.app, catalog);
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
   * Rebuilds `completionCatalog` from every configured pack plus the
   * standard set, the same discovery + catalog pairing `insertComponent`
   * uses. Called from `onload` and again from `savePackSettings`, so
   * adding or removing a pack folder updates what completes without a
   * plugin reload.
   *
   * A pack-discovery failure never leaves the catalog stale with a broken
   * promise: `discoverConfiguredPacks` already degrades quietly (a bad
   * folder is simply skipped, never thrown), so a caught error here still
   * falls back to the standard set alone, matching `insertComponent`'s
   * posture exactly.
   */
  private async refreshCompletionCatalog(): Promise<void> {
    let packs: Awaited<ReturnType<typeof discoverConfiguredPacks>> = [];
    try {
      packs = await discoverConfiguredPacks(
        this.packSettings.packFolders,
        this.vaultBasePath(),
      );
    } catch {
      packs = [];
    }
    this.completionCatalog = buildComponentCatalog(packs);
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
    // Adding or removing a pack folder should update what autocompletes
    // without requiring a plugin reload. Not awaited, for the same reason
    // `onload`'s call isn't: this is a settings-tab action, not something
    // that should block on a filesystem walk.
    void this.refreshCompletionCatalog();
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
