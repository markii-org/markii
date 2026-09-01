import { ItemView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createValueStore } from '@markii/runtime';
import type { RunTrigger, StoredValue } from '@markii/runtime';
import {
  buildPackRegistrationScript,
  mergeArrivingValue,
  readPersistedValues,
  runOnce,
  spawnRun as spawnRunHost,
  staleValuesForRehydration,
} from '@markii/host';
import type { RunOnceResult, SpawnRunOptions } from '@markii/host';
import { extractFrontmatterUses } from '@markii/core';
import { resolveUses } from '@markii/pack';
import { defaultRegistry } from '@markii/react/components';
import { renderDocument } from './render-document.js';
import {
  VaultImageDocument,
  createUnresolvedImageReporter,
} from './preview-images.js';
import type { VaultImageResolver } from './preview-images.js';
import { createLocalStorageMemento } from './run/local-storage-memento.js';
import {
  promptHostModal,
  promptManyHostsModal,
  promptUnknownHostsModal,
} from './run-modals.js';
import { refreshIntervalMsFromSeconds } from './local-settings.js';
import { loadPackContext } from './packs/pack-context.js';
import type { PackContext } from './packs/pack-context.js';
import {
  PACK_COMPILATION_UNAVAILABLE_NOTICE,
  compilationUnavailableSkipCount,
  formatPackDiagnosticLines,
  packCollisionNotice,
  packLoadFailureNotice,
  skippedPackCount,
} from './packs/pack-diagnostics.js';
import { createPackRegistrationBuilder } from './packs/pack-compilation.js';
import {
  applyPackStylesheets,
  removePackStylesheets,
} from './packs/pack-styles.js';
import { PREVIEW_WIDTH_CLASSES, previewWidthClassName } from './settings.js';
import type MarkiiPlugin from './main.js';

export const MARKII_PREVIEW_VIEW_TYPE = 'markii-preview';

const MK_MD_SUFFIX = '.mk.md';

/** External wall-clock budget for one run — forwarded verbatim to `spawnRun`'s own watchdog (`@markii/host`'s `run/run-host.ts`); the worker cannot influence or extend it. Matches `apps/vscode/src/preview-panel.ts`'s `RUN_TIMEOUT_MS`. */
const RUN_TIMEOUT_MS = 15_000;

/**
 * Imports `obsidian` — see `src/main.ts`'s file-scope note and
 * `src/obsidian-import-guard.test.ts`. This view owns the Run path's whole
 * lifecycle for the note it is currently showing: reading the file,
 * running its scripts (manual command, at-most-once run-on-open, and the
 * scheduled-refresh timer), and rendering the resulting values. A run's
 * outcome is reported through `Notice` + the developer console
 * (`reportRunOutcome` below) rather than an in-page marker — this host has
 * real notifications, so the page itself stays clean (AGENTS.md's
 * cleanliness principle). It is wiring only — the actual grant/run/tier
 * logic lives entirely in `@markii/host` and `@markii/runtime`.
 *
 * STORAGE: every persisted value this view touches (network grants, the
 * run cache, last-known values) goes through
 * `createLocalStorageMemento`, backed by `app.saveLocalStorage`/
 * `loadLocalStorage` — device-local, never `saveData`. See
 * `src/run/local-storage-memento.ts`'s top comment and
 * `src/storage-boundary.test.ts`, which fails the suite if that ever
 * changes.
 */
export class MarkiiPreviewView extends ItemView {
  private readonly plugin: MarkiiPlugin;
  private root: Root | null = null;
  private currentFile: TFile | null = null;
  private values: Record<string, StoredValue> | undefined;
  private running = false;
  /** At-most-once run-on-open, for this view's whole lifetime — mirrors `apps/vscode/src/preview-panel.ts`'s `ActivePreview.ranOnOpen` (panel-lifetime, not per-document: switching notes in the same view does not re-trigger it). */
  private ranOnOpen = false;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  /**
   * This preview's currently-loaded component packs (docs/packs.md) —
   * loaded once per preview open (see `onOpen` below and
   * `src/settings-tab.ts`'s note that reloading a pack requires reopening
   * the preview). `undefined` before the first load completes, in which
   * case `refresh()` renders with the plain `defaultRegistry` and no
   * `uses:` marker, exactly as if no packs were configured.
   */
  private packContext: PackContext | undefined;
  /** The last completed run's failure details (`RunOnceResult.failureDetails`), kept so the "Show Markii diagnostics" command can replay them on demand — diagnostics-surface only, never rendered into the page. */
  private lastRunFailures: RunOnceResult['failureDetails'] = [];

  /**
   * The console line for an image source that names no file in the vault
   * (`src/preview-images.ts`). One per source per note for this view's
   * whole life, so a note that re-renders every refresh interval cannot
   * turn one missing picture into a console drip. No `Notice`: a broken
   * image is visible in the page on its own, so this is the reason, not
   * the alarm.
   */
  private readonly reportUnresolvedImage = createUnresolvedImageReporter(
    (line) => {
      console.warn(line);
    },
  );

  /**
   * This preview's currently-loaded pack registry and stylesheets, for
   * `main.ts`'s export commands (GitHub issue #28, slice 2): an export
   * reuses whatever this open preview already loaded rather than loading
   * a second copy. `undefined` before the first load completes, or once
   * the view has closed and torn its pack context down, exactly the cases
   * `refresh()` itself treats as "no packs".
   *
   * Also `undefined` when the load found no packs at all. An export with
   * nothing to add to the standard set renders through `@markii/html`
   * instead, which produces the same document the static engine has
   * always produced for a pack-free note: the React path exists to bring
   * pack components along, so it is not worth taking when there are none.
   */
  exportPackContext():
    | {
        registry: PackContext['registry'];
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

  constructor(leaf: WorkspaceLeaf, plugin: MarkiiPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  override getViewType(): string {
    return MARKII_PREVIEW_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return 'Markii Preview';
  }

  override getIcon(): string {
    return 'file-text';
  }

  override async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] ?? this.containerEl;
    container.addClass('mk-obsidian-preview');
    this.root = createRoot(container);
    this.applyPreviewWidth();

    // The rendered pane is where a reader actually is when they want to
    // re-run or export a note, so the two primary actions belong in ITS
    // header rather than only in the palette. `ItemView.addAction` puts
    // them next to the view's own menu, and this view is created fresh per
    // open, so there is nothing to deduplicate.
    //
    // These two only. PDF, the cascade export, Insert component, and Show
    // diagnostics stay palette-only: a header that offers everything
    // offers nothing, and each of those is either a variant of an action
    // already here or a tool a reader reaches for deliberately.
    this.addAction('play', 'Run Markii scripts', () => {
      void this.runScripts('manual');
    });
    this.addAction('file-code', 'Export Markii note as HTML', () => {
      void this.plugin.exportActiveNoteAsHtml();
    });

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        void this.refresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.path === this.currentFile?.path) {
          void this.refresh();
        }
      }),
    );

    // Scheduled refresh (read-only tier, `@markii/runtime`'s trigger-to-tier
    // gate): read once here, like every other per-view setting — a change
    // to `markii.refreshIntervalSeconds` takes effect on the next preview
    // open, matching `apps/vscode/src/preview-panel.ts`'s own posture.
    // Cleared in `onClose` (and, transitively, on plugin unload — Obsidian
    // closes every open view for a disabled plugin) so a torn-down preview
    // never keeps firing.
    const intervalMs = refreshIntervalMsFromSeconds(
      this.plugin.localSettings.refreshIntervalSeconds,
    );
    if (intervalMs !== undefined) {
      this.refreshTimer = setInterval(() => {
        void this.runScripts('scheduled');
      }, intervalMs);
    }

    // Component packs (docs/packs.md): loaded once per preview open, before
    // the first render, so the very first `refresh()` already has the
    // merged registry and any pack stylesheets in place. A failure here
    // never blocks the preview — `loadPackContext` degrades quietly to "no
    // packs" the same way an empty pack-folder setting would.
    await this.loadPacks();

    await this.refresh();
  }

  override async onClose(): Promise<void> {
    if (this.refreshTimer !== undefined) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.packContext) {
      removePackStylesheets(
        document,
        this.packContext.stylesheets.map((sheet) => sheet.namespace),
      );
      this.packContext = undefined;
    }
    this.root?.unmount();
    this.root = null;
  }

  /**
   * Puts the current `previewWidth` setting (`src/settings.ts`) on the view
   * root as a class, dropping whichever one was there before. Cosmetic
   * only, which is why it lives in the vault-synced settings alongside
   * preview placement rather than in the device-local ones.
   *
   * Public so the settings tab can apply a change to an already-open
   * preview instead of making the reader close and reopen it; `refresh()`
   * calls it too, so a preview that outlives a settings change still lands
   * on the right width.
   */
  applyPreviewWidth(): void {
    const container = this.containerEl.children[1] ?? this.containerEl;
    for (const className of PREVIEW_WIDTH_CLASSES) {
      container.removeClass(className);
    }
    const current = previewWidthClassName(this.plugin.settings.previewWidth);
    if (current !== undefined) container.addClass(current);
  }

  /**
   * Loads this preview's component packs (docs/packs.md) from the plugin's
   * device-local pack-folder setting, merges their components into a
   * render registry, and injects their stylesheets. Never throws — every
   * step `loadPackContext` composes already degrades quietly to "this pack
   * didn't load, here's why" (`PackContext.skipped`), never a crash or an
   * error dump in the preview (AGENTS.md's cleanliness principle).
   */
  private async loadPacks(): Promise<void> {
    const cacheDir = this.plugin.packCacheDir();
    const browserModulePath = this.plugin.esbuildBrowserModulePath();
    const wasmBinaryPath = this.plugin.esbuildWasmBinaryPath();

    const context = await loadPackContext(
      this.plugin.packSettings.packFolders,
      this.plugin.vaultBasePath(),
      defaultRegistry,
      {
        cacheDir,
        // Not `buildPackRegistrationScript` directly: on a three-file
        // install (BRAT, later the community catalogue) the esbuild-wasm
        // runtime is simply not there, since it is deliberately not
        // embedded into `main.js` the way the Run path's worker bundle is.
        // `createPackRegistrationBuilder` turns that into a clean, named
        // refusal per pack instead of letting the real builder fail with a
        // raw module-resolution error — see `./packs/pack-compilation.ts`.
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

    this.packContext = context;
    applyPackStylesheets(document, context.stylesheets);
    this.logPackDiagnostics();
    this.notifyPackFailures(context);
  }

  /**
   * Writes this pack load's diagnostic lines (`src/packs/pack-diagnostics.ts`)
   * to the console — one line per successfully loaded pack, one per skipped
   * folder with its reason, plus any CSS-lint or registration warnings.
   * AGENTS.md's cleanliness principle: "every failure needs a full
   * diagnostic somewhere a user can find it." Obsidian has no output
   * channel, so `console` is that "somewhere" (paired with `Notice` for
   * failures a user must act on — see `notifyPackFailures`). Public so
   * `main.ts`'s "Show Markii diagnostics" command can call it on demand.
   */
  logPackDiagnostics(): void {
    console.log(`[markii] pack load at ${new Date().toISOString()}`);
    if (!this.packContext) {
      console.log('[markii]   no packs loaded yet for this preview');
      return;
    }
    const lines = formatPackDiagnosticLines(this.packContext);
    if (lines.length === 0) {
      console.log('[markii]   no pack folders configured');
      return;
    }
    for (const line of lines) {
      console.log(`[markii]   ${line}`);
    }
    if (this.lastRunFailures.length > 0) {
      console.log(
        `[markii] last run's ${String(this.lastRunFailures.length)} failure(s):`,
      );
      for (const failure of this.lastRunFailures) {
        console.log(
          `[markii]   ${failure.name} (${failure.kind}): ${failure.message}`,
        );
      }
    }
  }

  /** A `Notice` for pack failures a user must act on — a skipped folder, or two packs sharing a namespace — never for the routine "nothing configured" case. All wording lives in `./packs/pack-diagnostics.ts`; each failure gets exactly ONE notice (a no-compiler skip gets the notice naming that cause, never additionally the generic one). */
  private notifyPackFailures(context: PackContext): void {
    const noCompiler = compilationUnavailableSkipCount(context);
    const otherSkips = skippedPackCount(context) - noCompiler;
    if (noCompiler > 0) {
      new Notice(PACK_COMPILATION_UNAVAILABLE_NOTICE);
    }
    if (otherSkips > 0) {
      new Notice(packLoadFailureNotice(otherSkips));
    }
    if (context.registrationCollisions.length > 0) {
      new Notice(packCollisionNotice(context.registrationCollisions));
    }
  }

  /**
   * The three vault calls the preview's image rewrite needs
   * (`src/preview-images.ts`): Obsidian's own link resolution, an
   * existence check, and the URL Obsidian serves a vault file at. Every
   * decision beyond these one-liners lives in that module and in
   * `src/vault-image-paths.ts`, which the export's image embedder walks
   * too, so a note previews with the same pictures it exports with.
   *
   * THE JAIL. All three are vault APIs: `getFirstLinkpathDest` searches
   * the link index, and the adapter cannot reach outside the vault it was
   * handed. `preview-images.ts` additionally refuses to pass on anything
   * that could read as an absolute path, so `getResourcePath` only ever
   * sees a vault-relative one.
   */
  private vaultImageResolver(): VaultImageResolver {
    const adapter = this.app.vault.adapter;
    return {
      linkpathDest: (src, from) =>
        this.app.metadataCache.getFirstLinkpathDest(src, from)?.path,
      vaultPathExists: (vaultPath) =>
        this.app.vault.getAbstractFileByPath(vaultPath) instanceof TFile,
      resourcePath: (vaultPath) => adapter.getResourcePath(vaultPath),
    };
  }

  /** The `GrantMemento` for this run's whole session — see this class's top comment on why every key it touches is device-local, never `saveData`. Built once per call so a stale reference is never reused across an `await`. */
  private memento(): ReturnType<typeof createLocalStorageMemento> {
    return createLocalStorageMemento(
      (key) => this.app.loadLocalStorage(key),
      (key, value) => {
        this.app.saveLocalStorage(key, value);
      },
      (key, error) => {
        // Device-local storage is finite and can genuinely fill up. The run
        // itself already succeeded; only persistence was lost, so this is
        // reported and not surfaced as a failed run.
        console.error(`[markii] could not persist "${key}"`, error);
        new Notice(
          'Markii: device storage is full, so this run was not saved for next time. The results above are still current.',
        );
      },
    );
  }

  /**
   * Runs the currently-shown note's scripts once. `trigger` flows straight
   * to `@markii/host`'s `runOnce`, which is what enforces the whole "effects
   * always cost a click" rule: only `'manual'` (the `run-markii-scripts`
   * command) runs the INTERACTIVE grant flow (the `run-modals.ts` prompts
   * below are simply never invoked for `'auto'`/`'scheduled'`); those two
   * triggers resolve grants from what was already granted by hand and never
   * prompt, and `@markii/runtime`'s trigger-to-tier gate caps them to the
   * read-only tier inside the worker itself — this view never works around
   * either gate, it only supplies the trigger.
   *
   * A press that arrives with no worker bundled (dev, before `npm run
   * build`), no current file, or while a previous run is still in flight is
   * a no-op — mirrors `apps/vscode/src/preview-panel.ts`'s `running` guard
   * and its reasoning (a run's cache-snapshot mutation is only safe to
   * persist once a run has fully finished).
   */
  async runScripts(trigger: RunTrigger): Promise<void> {
    if (this.running) return;
    const file = this.currentFile;
    if (!file) return;

    if (!this.plugin.browserWorker) {
      console.error(
        'Markii: runScripts skipped — this main.js carries no embedded worker bundle (run `npm run build`, which embeds it).',
      );
      if (trigger === 'manual') {
        new Notice(
          "Markii: this note's scripts cannot run. The plugin build is missing its worker bundle, so reinstall the plugin.",
        );
      }
      return;
    }
    const { spawnIsolate } = this.plugin.browserWorker;

    this.running = true;
    const documentKey = file.path;
    const memento = this.memento();

    try {
      const text = await this.app.vault.cachedRead(file);
      const packModules =
        this.packContext && this.packContext.packs.length > 0
          ? this.packContext.packModules
          : undefined;
      const result = await runOnce({
        documentKey,
        text,
        trigger,
        memento,
        promptHost: promptHostModal(this.app),
        promptUnknownHosts: promptUnknownHostsModal(this.app),
        promptManyHosts: promptManyHostsModal(this.app),
        // `workerPath` is still passed because `spawnRun` hands it to the
        // isolate as its entry; the Web Worker implementation ignores the
        // value and starts from the blob URL it minted at load. It is a
        // label rather than a path on purpose: there is no such FILE any
        // more, since the worker bundle ships base64-embedded inside
        // `main.js` (`src/run/embedded-assets.ts`), so naming a real-looking
        // filename here would only mislead whoever reads it next. The
        // watchdog, the settlement rules, and the never-rejects contract
        // are `spawnRun`'s either way.
        spawnRun: (options: SpawnRunOptions) =>
          spawnRunHost({
            ...options,
            workerPath: 'markii:embedded-worker',
            spawnIsolate,
          }),
        timeoutMs: RUN_TIMEOUT_MS,
        ...(packModules !== undefined ? { packModules } : {}),
        // GitHub issue #35: each script's value is applied the moment it
        // arrives, so its component goes fresh while the rest of the note
        // stays stale, rather than every value flipping when the batch
        // ends. The note being shown may have changed mid-run, which is
        // the same check the completed run makes below. `refresh()` is
        // re-entrant here: it reads `this.values` after its own await, and
        // values only ever accumulate during a run, so whichever render
        // lands last is the most complete one.
        onValue: (name, value) => {
          if (this.currentFile?.path !== documentKey) return;
          this.values = mergeArrivingValue(this.values, name, value);
          void this.refresh();
        },
      });

      // The file shown may have changed while the run (grant prompts
      // included) was in flight; only apply the result if we're still
      // looking at the same note.
      if (this.currentFile?.path !== documentKey) return;

      this.values = result.values;
      this.lastRunFailures = result.failureDetails;
      this.reportRunOutcome(trigger, result.failureDetails);
      await this.refresh();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('Markii: runScripts failed:', detail);
      // AGENTS.md's cleanliness principle: a quiet, stack-free notice for
      // the run a user just asked for; a scheduled/auto run failing this
      // way is reported to the console only, so a bad timer never turns
      // into a notification every interval.
      if (trigger === 'manual') {
        new Notice("Markii: running this note's scripts failed.");
      }
      if (this.currentFile?.path === documentKey) await this.refresh();
    } finally {
      this.running = false;
    }
  }

  /**
   * A completed run's outcome, on this host's two designated surfaces
   * (AGENTS.md, "clean is not silent"): every failure gets a full line in
   * the developer console, and a MANUAL run — the one a user is actively
   * watching for — additionally gets a `Notice` either way. A scheduled/
   * auto run stays quiet on success (its updated values are the feedback)
   * and quiet-but-logged on failure, so a monitoring note can never turn
   * into a notification drip; its per-value failure markers still render
   * in the page itself.
   */
  private reportRunOutcome(
    trigger: RunTrigger,
    failures: RunOnceResult['failureDetails'],
  ): void {
    if (failures.length === 0) {
      if (trigger === 'manual') new Notice("Markii: this note's scripts ran.");
      return;
    }
    console.error(
      `[markii] run (${trigger}) finished with ${String(failures.length)} failure(s):`,
    );
    for (const failure of failures) {
      console.error(
        `[markii]   ${failure.name} (${failure.kind}): ${failure.message}`,
      );
    }
    if (trigger === 'manual') {
      const what =
        failures.length === 1
          ? 'a script failed'
          : `${String(failures.length)} scripts failed`;
      new Notice(`Markii: ${what}. Open the Markii diagnostics for details.`);
    }
  }

  private async refresh(): Promise<void> {
    this.applyPreviewWidth();
    const file = this.app.workspace.getActiveFile();
    const isNewFile = file?.path !== this.currentFile?.path;
    this.currentFile = file;

    if (!this.root) {
      return;
    }

    if (!file || !file.path.endsWith(MK_MD_SUFFIX)) {
      this.values = undefined;
      this.root.render(
        createElement(
          'p',
          { className: 'mk-obsidian-preview__empty' },
          'Open a .mk.md file to preview it here.',
        ),
      );
      return;
    }

    if (isNewFile) {
      // A freshly-shown note: forget the previous note's values and
      // rehydrate this one's last-known values (marked stale — GitHub
      // issue #11's rehydration behavior, `staleValuesForRehydration`) so
      // it renders its last figures instantly, before (or without) any
      // fresh run.
      const persisted = readPersistedValues(this.memento(), file.path);
      this.values =
        Object.keys(persisted).length > 0
          ? staleValuesForRehydration(persisted)
          : undefined;
    }

    const text = await this.app.vault.cachedRead(file);
    const store =
      this.values && Object.keys(this.values).length > 0
        ? createValueStore(this.values)
        : undefined;
    const registry = this.packContext?.registry;

    // docs/packs.md's `uses:` surfacing: a note declaring a pack that is
    // not installed still renders fully (its directives already fall back
    // to the standard unknown-component box); this is only the quiet
    // marker that explains WHY, so a user is not left guessing whether the
    // setting was even read.
    const usesResolution = resolveUses(
      extractFrontmatterUses(text),
      this.packContext?.namespaces ?? [],
    );

    this.root.render(
      createElement(
        Fragment,
        null,
        // The `.doc` wrapper, with the image rewrite attached to it: a
        // relative `<img src>` is resolved against the vault after every
        // render, value updates included (`src/preview-images.ts`). The
        // `key` is the note's path so switching notes remounts the tree
        // rather than reusing an `<img>` still holding the previous
        // note's resolved URL.
        createElement(
          VaultImageDocument,
          {
            key: file.path,
            notePath: file.path,
            resolver: this.vaultImageResolver(),
            onUnresolved: this.reportUnresolvedImage,
          },
          renderDocument(text, store, registry),
        ),
        usesResolution.missing.length > 0
          ? createElement(
              'p',
              {
                className: 'mk-obsidian-uses-marker',
                title: `This note declares packs that are not installed: ${usesResolution.missing.join(', ')}. Add their folders in Markii's settings, under "Component packs".`,
              },
              usesResolution.missing.length === 1
                ? `Pack not installed: ${usesResolution.missing[0]}`
                : `Packs not installed: ${usesResolution.missing.join(', ')}`,
            )
          : null,
      ),
    );

    // GitHub issue #11's run-on-open, ported to this host: at most once per
    // view life, and only ever the read-only `'auto'` tier — never a prompt
    // on open (`runOnce` resolves grants non-interactively for this
    // trigger, so the prompt adapters above are simply never invoked).
    if (isNewFile && !this.ranOnOpen && this.plugin.localSettings.runOnOpen) {
      this.ranOnOpen = true;
      void this.runScripts('auto');
    }
  }
}
