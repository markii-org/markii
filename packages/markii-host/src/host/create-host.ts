/**
 * `createMarkiiHost`: the behaviors every app calls instead of assembling
 * its own run/export/pack/editor wiring. Everything it touches (files, prompts,
 * the isolate) arrives through the adapter, so the main entry stays
 * environment-neutral. VS Code's webview imports only the pure pieces and
 * never calls this function.
 *
 * It provides `run`, `diagnostics`, `open`, `exportNote`, `installPack`, `loadPacks`, `completeAt`,
 * `hoverAt`, and `insertComponent`, over the behavior modules (`./export-behavior.js`, `./pack-install.js`,
 * `./pack-load.js`, `./editor-behavior.js`). Every one of them
 * returns the shared `Unsupported` outcome, with one diagnostics line,
 * when the adapter lacks the capability it needs — AGENTS.md's "clean is
 * not silent": a decline is never a silent no-op.
 */
import type {
  HostAdapter,
  HostExportFormat,
  HostPackSource,
  HostTextEdit,
} from './adapter.js';
import type { RunResult, SpawnRunRequest } from '../run/run-host.js';
import type { StoredValue } from '@markii/runtime';
import type { OnDiagnostic, UnavailableComponent } from '@markii/stdlib';
import type {
  CompletionItem,
  ComponentDocumentation,
  InsertableComponent,
  LineColumn,
} from '@markii/stdlib/editor';
import {
  runViaAdapter,
  type RunViaAdapterRequest,
  type RunViaAdapterResult,
} from './run-behavior.js';
import { type ArchiveExtractFs } from './pack-archive.js';
import {
  installPackDiagnosticLines,
  installPackFromArchive,
} from './pack-install.js';
import {
  loadPacksViaAdapter,
  packDiscoveryIoFromAdapter,
  type PackDiscoveryIo,
} from './pack-load.js';
import type {
  ExportBodyRenderer,
  ExportPackStylesheet,
  ExportRenderInfo,
  HtmlExportEngine,
  StaticExportReason,
} from '../export/note-export.js';
import type {
  EmbeddedImageReport,
  ExportImageReader,
} from '../export/image-embed.js';
import { buildComponentCatalog } from '../insert/component-catalog.js';
import {
  formatPackDiagnosticLines,
  skippedPackFolderLine,
} from '../packs/pack-diagnostics.js';
import type { DiscoveredPack, SkippedPackFolder } from '../packs/discover.js';
import {
  readTerminalPackScripts,
  type TerminalPackScript,
} from './terminal-packs.js';
import {
  removePackDiagnosticLine,
  removePackViaAdapter,
  type RemovePackOutcome,
} from './pack-remove.js';
import { formatComponentDocumentation } from '@markii/stdlib/editor';
import {
  exportDiagnosticLines,
  exportNoteFileViaAdapter,
} from './export-behavior.js';
import {
  disablePackDiagnosticLine,
  disablePackViaAdapter,
  enablePackDiagnosticLine,
  enablePackViaAdapter,
  forgetPackTrust,
  listInstalledPacks,
  notEnabledPackDiagnosticLine,
  trustedPackFolders,
  usesPackTrust,
} from './pack-trust-behavior.js';
import type {
  DisablePackOutcome,
  EnablePackOutcome,
  InstalledPacksListing,
} from './pack-trust-behavior.js';
import {
  completionPlanAt,
  createCatalogCache,
  hoverAtViaEditor,
  insertComponentPlan,
} from './editor-behavior.js';

/** The shared decline shape every behavior returns when the adapter lacks the capability it needs. */
export interface Unsupported {
  readonly kind: 'unsupported';
  readonly capability:
    'isolate' | 'editor' | 'packs' | 'pack-trust' | 'export-format';
  readonly detail?: string;
}

function unsupported(
  adapter: HostAdapter,
  capability: Unsupported['capability'],
  detail: string,
): Unsupported {
  adapter.diagnostics(
    `declined (${capability} unsupported on ${adapter.id}): ${detail}`,
  );
  return { kind: 'unsupported', capability, detail };
}

// --- open ------------------------------------------------------------

export interface OpenRequest {
  readonly path: string;
}

export type OpenOutcome =
  | { readonly kind: 'opened'; readonly text: string }
  | { readonly kind: 'failed'; readonly reason: string };

// --- run -------------------------------------------------------------

export type RunRequest = RunViaAdapterRequest;

export type RunOutcome =
  ({ readonly kind: 'ran' } & RunViaAdapterResult) | Unsupported;

// --- export ------------------------------------------------------------

export interface ExportRequest {
  readonly format: HostExportFormat;
  /** The note's own path, used to name the exported file. */
  readonly notePath: string;
  readonly text: string;
  /** The note's last-run values, baked into an html/pdf export. Omitted or empty exports the note's standard empty states. */
  readonly values?: Record<string, StoredValue>;
  /**
   * Installed pack components the static HTML engine cannot draw. A
   * directive naming one is labeled "no HTML view" instead of "unknown
   * component" in the exported file. Used only when the static engine
   * renders the body.
   */
  readonly unavailableComponents?: readonly UnavailableComponent[];
  /** Receives the static engine's render diagnostics, such as the `no-engine-view` event. */
  readonly onDiagnostic?: OnDiagnostic;
  /** The host's own render of the body (a React pass bound to its loaded packs). Omitted means the static engine renders, and `staticReason` says why. Used by the `html` and `pdf` formats. */
  readonly renderBody?: ExportBodyRenderer;
  /** Why the static engine renders when `renderBody` is omitted. Defaults to `no-packs`. */
  readonly staticReason?: StaticExportReason;
  /** The loaded packs' stylesheets, embedded only when `renderBody` ran. */
  readonly packStylesheets?: readonly ExportPackStylesheet[];
  /** How many loaded packs contributed to the render. Diagnostics only. */
  readonly packCount?: number;
  /** Reads one of the note's local images so the export embeds it as a `data:` URI. Omitted leaves every image source as written. */
  readonly embedImages?: ExportImageReader;
  /** Hides the collapsed script marker in the exported file. Defaults to `false`. */
  readonly hideScriptBlocks?: boolean;
}

export type ExportOutcome =
  | {
      readonly kind: 'exported';
      readonly path: string;
      readonly bytes: number;
      /** How many last-run values were baked into the file. */
      readonly valueCount: number;
      /** `true` when the note contains a script fence. */
      readonly hasScripts?: boolean;
      /** Which engine rendered the body, and why when it was the static one. */
      readonly render: ExportRenderInfo;
      /** What image embedding did. */
      readonly images: EmbeddedImageReport;
    }
  | { readonly kind: 'failed'; readonly reason: string }
  /** `adapter.exports.resolveTarget`/`htmlToPdf`/an injected `renderAnsi` was unavailable at the moment of export — a picker cancel, or a seam this host declared but did not wire up. */
  | { readonly kind: 'cancelled' }
  | Unsupported;

// --- packs ---------------------------------------------------------------

export interface InstallPackRequest {
  readonly archiveBytes: Uint8Array;
  /** The archive's own path or display name, used only in wording. Defaults to a generic phrase when omitted. */
  readonly archivePath?: string;
}

export type InstallPackOutcome =
  | {
      readonly kind: 'installed';
      readonly namespace: string;
      /** The folder the pack now lives in, under the adapter's install root. */
      readonly installedDir: string;
      readonly replaced: boolean;
    }
  | {
      readonly kind: 'declined';
      readonly step: 'consent' | 'replace';
      readonly namespace: string;
    }
  | { readonly kind: 'reserved'; readonly namespace: string }
  | { readonly kind: 'rejected'; readonly reason: string }
  | Unsupported;

export type LoadPacksOutcome =
  | {
      readonly kind: 'loaded';
      readonly namespaces: readonly string[];
      /** The discovered, engine-gated packs themselves, for a host that loads their code. */
      readonly packs: readonly DiscoveredPack[];
      /** Folders that produced no usable pack, each with its reason. */
      readonly skipped: readonly SkippedPackFolder[];
      /** Every installed pack component with the engines it has a view for, dropped packs included. For an engine that draws no pack views. */
      readonly components: readonly UnavailableComponent[];
      /** The installed components with no view for this host's engine, for a renderer's `unavailableComponents` option. */
      readonly unavailable: readonly UnavailableComponent[];
    }
  | Unsupported;

export type LoadTerminalPacksOutcome =
  | {
      readonly kind: 'loaded';
      readonly namespaces: readonly string[];
      readonly packs: readonly DiscoveredPack[];
      readonly skipped: readonly SkippedPackFolder[];
      /** Every installed pack component with the engines it has a view for, dropped packs included. For an engine that draws no pack views. */
      readonly components: readonly UnavailableComponent[];
      /** The installed components with no view for the terminal engine, for its renderer's `unavailableComponents` option. */
      readonly unavailable: readonly UnavailableComponent[];
      /** Each terminal-capable pack's `terminal.js` text, for the engine's own loader. */
      readonly scripts: readonly TerminalPackScript[];
      /**
       * The diagnostics lines that report a real failure (an unusable pack
       * folder, a missing or unreadable `terminal.js`), as opposed to the
       * informational ones. Every line is also written to the diagnostics
       * surface; a host that gates informational lines behind a flag still
       * shows these.
       */
      readonly failureLines: readonly string[];
    }
  | Unsupported;

export type RemovePackResult = RemovePackOutcome | Unsupported;

export type InstalledPacksOutcome =
  ({ readonly kind: 'listed' } & InstalledPacksListing) | Unsupported;

export type EnablePackResult = EnablePackOutcome | Unsupported;

export type DisablePackResult = DisablePackOutcome | Unsupported;

// --- editor seam -----------------------------------------------------

export interface EditorPositionRequest {
  readonly line: number;
  readonly column: number;
  /**
   * The document the position belongs to. Omitted, the adapter's own
   * `editor.documentText()` is read. A provider invoked for a document that
   * is not the host's active editor (VS Code asks about any visible
   * document) passes its own text here.
   */
  readonly documentText?: string;
}

export type CompleteOutcome =
  | {
      readonly kind: 'completions';
      readonly labels: readonly string[];
      /** The full items, so a host can map them onto its own popup rows. */
      readonly items: readonly CompletionItem[];
      /** Zero-based columns an accepted item replaces. */
      readonly replaceStart: number;
      readonly replaceEnd: number;
      /** Where the name token starts, for filtering. Equals `replaceStart` unless a colon run precedes the name. */
      readonly tokenStart: number;
      /** Fence rewrites to apply with an accepted container item, in one undo step, in pre-edit coordinates. Empty otherwise. */
      readonly fenceEdits: readonly HostTextEdit[];
    }
  /** Nothing to offer here: no directive context, or a bare colon run closing an open container. Not a failure. */
  | { readonly kind: 'none' }
  | Unsupported;

export type HoverOutcome =
  | {
      readonly kind: 'hover';
      readonly text: string;
      /** The structured documentation, for a host that renders its own markup. */
      readonly documentation: ComponentDocumentation;
      /** Zero-based columns of the hovered directive name, for the hover range. */
      readonly start: number;
      readonly end: number;
    }
  | { readonly kind: 'none' }
  | Unsupported;

export interface InsertComponentRequest {
  readonly name: string;
}

export type InsertOutcome =
  | {
      readonly kind: 'inserted';
      /**
       * Where a caller with its own selection/cursor concept (VS Code's
       * `editor.selection`, Obsidian's `Editor.setCursor`) should place it
       * once the edit lands: the position `insertComponentPlan` computed
       * INSIDE the inserted skeleton (e.g. the blank line between a
       * container's fences), not merely the end of the inserted text.
       * `HostEditor.applyEdits` only reports success or failure, so this
       * is the one place that offset survives the call.
       */
      readonly cursor: LineColumn;
    }
  | { readonly kind: 'not-found'; readonly name: string }
  | { readonly kind: 'failed' }
  | Unsupported;

// --- the host itself ---------------------------------------------------

export interface MarkiiHost {
  open(request: OpenRequest): Promise<OpenOutcome>;
  run(request: RunRequest): Promise<RunOutcome>;
  exportNote(request: ExportRequest): Promise<ExportOutcome>;
  installPack(request: InstallPackRequest): Promise<InstallPackOutcome>;
  loadPacks(): Promise<LoadPacksOutcome>;
  /**
   * `loadPacks` for a host running the terminal engine: also reads each
   * pack's `terminal.js`. Unsupported unless the adapter's pack source
   * declares the `ansi` engine.
   */
  loadTerminalPacks(): Promise<LoadTerminalPacksOutcome>;
  /** Removes one installed pack by namespace, through the install root. Writes its outcome to the diagnostics surface. Under `trust: 'device-list'` it also withdraws the namespace's trust entry. */
  removePack(namespace: string): Promise<RemovePackResult>;
  /**
   * Under `trust: 'device-list'`: the install root's folders split into the
   * ones this device has enabled and the ones merely present. Unsupported
   * for a host that does not declare the trust list.
   */
  installedPacks(): Promise<InstalledPacksOutcome>;
  /** Asks the install consent prompt, then trusts an installed folder on this device. Unsupported without the trust list. */
  enablePack(namespace: string): Promise<EnablePackResult>;
  /** Withdraws a namespace's trust entry and leaves its folder in place. Unsupported without the trust list. */
  disablePack(namespace: string): Promise<DisablePackResult>;
  completeAt(request: EditorPositionRequest): Promise<CompleteOutcome>;
  /**
   * `completeAt` for a caller that must answer synchronously (Obsidian's
   * `EditorSuggest.onTrigger`). Reads the cached catalog; while the cache
   * is cold it answers from the standard set and starts warming the cache,
   * so the next request sees installed packs.
   */
  completeAtSync(request: EditorPositionRequest): CompleteOutcome;
  /** Drops the cached completion/hover catalog, for a host whose pack folders just changed. `installPack` and `loadPacks` do this themselves. */
  invalidateCatalog(): void;
  hoverAt(request: EditorPositionRequest): Promise<HoverOutcome>;
  insertComponent(request: InsertComponentRequest): Promise<InsertOutcome>;
  diagnostics(line: string): void;
}

/**
 * Injectables a test needs to make a run/export deterministic. Defaults
 * are the real implementations; no option changes behavior for a real
 * host.
 */
export interface MarkiiHostOptions {
  readonly spawnRun?: (options: SpawnRunRequest) => Promise<RunResult>;
  /** The `.mkp` extraction filesystem `installPack` writes through. Required for a host that installs packs (`createNodeArchiveExtractFs()` from `@markii/host/node`); without it `installPack` is `Unsupported`. */
  readonly archiveExtractFs?: ArchiveExtractFs;
  /** The static HTML engine behind the `html` and `pdf` exports (`createHtmlExportEngine()` from `@markii/host/html-engine`). Without it those formats decline, like `renderAnsi` for `ansi`. */
  readonly htmlEngine?: HtmlExportEngine;
  /** Pack discovery's file reads. Defaults to reads through the adapter's own `readFile` and `listFolder`. */
  readonly packDiscoveryIo?: PackDiscoveryIo;
  /** `@markii/ansi`'s renderer, injected because this package never depends on `@markii/ansi` (a platform renderer, never a `@markii/host` dependency). A host declaring `'ansi'` in `adapter.exports.formats` without supplying this gets `Unsupported` at export time. */
  readonly renderAnsi?: (text: string) => Promise<string>;
  /** Composes a pack-aware render registry (webview registration, in-process evaluation, ...). Reserved for a future slice that renders through `exportNote`'s `html` path with packs; unused today, since `buildExportDocument`'s default (no `renderBody`) already produces a correct, pack-free static export. */
  readonly buildPackRegistration?: unknown;
}

export function createMarkiiHost(
  adapter: HostAdapter,
  options: MarkiiHostOptions = {},
): MarkiiHost {
  const packIo = options.packDiscoveryIo ?? packDiscoveryIoFromAdapter(adapter);

  /**
   * The pack source every load reads: under `trust: 'device-list'` the
   * trusted installed folders are added to what the adapter authorizes, so
   * an untrusted folder is never a candidate for discovery. Other hosts
   * get their own source back unchanged.
   */
  function packSource(packs: HostPackSource): HostPackSource {
    if (!usesPackTrust(adapter)) return packs;
    return {
      ...packs,
      authorizedFolders: async () => [
        ...(await packs.authorizedFolders()),
        ...(await trustedPackFolders(adapter)),
      ],
    };
  }

  /** The pack-aware insert/completion catalog, built fresh from this host's currently authorized folders. Not cached here: `./editor-behavior.js`'s `createCatalogCache` is the caching seam, and a caller wiring a live editor (repeated completion/hover calls per keystroke) is expected to wrap this call in one. */
  async function currentCatalog(): Promise<readonly InsertableComponent[]> {
    if (!adapter.packs) return buildComponentCatalog([]);
    const { packs } = await loadPacksViaAdapter(
      packSource(adapter.packs),
      packIo,
    );
    return buildComponentCatalog(
      [...(adapter.packs.bundledPacks?.() ?? []), ...packs],
      adapter.packs.engine,
    );
  }

  /** Completion and hover fire per keystroke, so they read a cached catalog. `insertComponent` stays uncached: it runs once per command. */
  const catalogCache = createCatalogCache(currentCatalog);

  function documentTextFor(
    editor: NonNullable<HostAdapter['editor']>,
    request: EditorPositionRequest,
  ): string {
    return request.documentText ?? editor.documentText();
  }

  function completeWith(
    catalog: readonly InsertableComponent[],
    request: EditorPositionRequest,
    editor: NonNullable<HostAdapter['editor']>,
  ): CompleteOutcome {
    const plan = completionPlanAt(
      documentTextFor(editor, request),
      request,
      catalog,
    );
    if (plan === undefined) return { kind: 'none' };
    return {
      kind: 'completions',
      labels: plan.items.map((item) => item.label),
      items: plan.items,
      replaceStart: plan.replaceStart,
      replaceEnd: plan.replaceEnd,
      tokenStart: plan.tokenStart,
      fenceEdits: plan.fenceEdits,
    };
  }

  return {
    async open(request: OpenRequest): Promise<OpenOutcome> {
      try {
        const bytes = await adapter.readFile(request.path);
        return { kind: 'opened', text: new TextDecoder().decode(bytes) };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        adapter.diagnostics(`could not open ${request.path}: ${reason}`);
        return { kind: 'failed', reason };
      }
    },

    async run(request: RunRequest): Promise<RunOutcome> {
      if (!adapter.isolate) {
        return unsupported(
          adapter,
          'isolate',
          'no isolate is configured, so scripts cannot run.',
        );
      }
      const result = await runViaAdapter(adapter, request, options.spawnRun);
      return { kind: 'ran', ...result };
    },

    async exportNote(request: ExportRequest): Promise<ExportOutcome> {
      const formats = adapter.exports?.formats;
      if (formats === undefined || !formats.has(request.format)) {
        return unsupported(
          adapter,
          'export-format',
          `export format "${request.format}" is not available on ${adapter.id}.`,
        );
      }

      const outcome = await exportNoteFileViaAdapter(
        adapter,
        request.format,
        {
          ...(options.htmlEngine !== undefined
            ? { engine: options.htmlEngine }
            : {}),
          notePath: request.notePath,
          text: request.text,
          ...(request.values !== undefined ? { values: request.values } : {}),
          ...(request.unavailableComponents !== undefined
            ? { unavailableComponents: request.unavailableComponents }
            : {}),
          ...(request.onDiagnostic !== undefined
            ? { onDiagnostic: request.onDiagnostic }
            : {}),
          ...(request.renderBody !== undefined
            ? { renderBody: request.renderBody }
            : {}),
          ...(request.staticReason !== undefined
            ? { staticReason: request.staticReason }
            : {}),
          ...(request.packStylesheets !== undefined
            ? { packStylesheets: request.packStylesheets }
            : {}),
          ...(request.packCount !== undefined
            ? { packCount: request.packCount }
            : {}),
          ...(request.embedImages !== undefined
            ? { embedImages: request.embedImages }
            : {}),
          ...(request.hideScriptBlocks !== undefined
            ? { hideScriptBlocks: request.hideScriptBlocks }
            : {}),
        },
        options.renderAnsi,
      );

      if (outcome === undefined) {
        adapter.diagnostics(
          `export declined: format "${request.format}" has no working export path on ${adapter.id} (a cancelled picker, or a missing renderer/PDF seam).`,
        );
        return { kind: 'cancelled' };
      }

      for (const line of exportDiagnosticLines(outcome)) {
        adapter.diagnostics(line);
      }

      if (outcome.kind === 'failed') {
        return { kind: 'failed', reason: outcome.reason };
      }
      return {
        kind: 'exported',
        path: outcome.path,
        bytes: outcome.bytes,
        valueCount: outcome.valueCount,
        ...(outcome.hasScripts !== undefined
          ? { hasScripts: outcome.hasScripts }
          : {}),
        render: outcome.render,
        images: outcome.images,
      };
    },

    async installPack(
      request: InstallPackRequest,
    ): Promise<InstallPackOutcome> {
      if (!adapter.packs?.installRoot) {
        return unsupported(
          adapter,
          'packs',
          'this host has no pack-install destination configured.',
        );
      }
      const archivePath = request.archivePath ?? 'the selected archive';
      const extractFs = options.archiveExtractFs;
      if (extractFs === undefined) {
        return unsupported(
          adapter,
          'packs',
          'this host was given no archive extraction filesystem.',
        );
      }

      const outcome = await installPackFromArchive(adapter, {
        archiveBytes: request.archiveBytes,
        archivePath,
        installRoot: adapter.packs.installRoot(),
        exists: (path) => adapter.exists(path),
        extractFs,
        reservedNamespaces: adapter.packs.reservedNamespaces(),
      });

      catalogCache.invalidate();
      for (const line of installPackDiagnosticLines(outcome, archivePath)) {
        adapter.diagnostics(line);
      }

      return outcome;
    },

    async loadPacks(): Promise<LoadPacksOutcome> {
      if (!adapter.packs) {
        return unsupported(
          adapter,
          'packs',
          'this host has no pack folders configured.',
        );
      }
      catalogCache.invalidate();
      const result = await loadPacksViaAdapter(
        packSource(adapter.packs),
        packIo,
      );
      for (const line of formatPackDiagnosticLines({
        packs: result.packs,
        skipped: result.skipped,
        engine: adapter.packs.engine,
        cssWarnings: [],
      })) {
        adapter.diagnostics(line);
      }
      if (usesPackTrust(adapter)) {
        for (const namespace of (await listInstalledPacks(adapter))
          .notEnabled) {
          adapter.diagnostics(
            notEnabledPackDiagnosticLine(namespace, adapter.labels.deviceNoun),
          );
        }
      }
      return {
        kind: 'loaded',
        namespaces: result.namespaces,
        packs: result.packs,
        skipped: result.skipped,
        components: result.components,
        unavailable: result.unavailable,
      };
    },

    async loadTerminalPacks(): Promise<LoadTerminalPacksOutcome> {
      if (!adapter.packs) {
        return unsupported(
          adapter,
          'packs',
          'this host has no pack folders configured.',
        );
      }
      if (adapter.packs.engine !== 'ansi') {
        return unsupported(
          adapter,
          'packs',
          'this host does not run the terminal engine, so it has no terminal packs.',
        );
      }
      catalogCache.invalidate();
      const result = await loadPacksViaAdapter(
        packSource(adapter.packs),
        packIo,
      );
      const read = await readTerminalPackScripts(adapter, result.packs);
      for (const line of formatPackDiagnosticLines({
        packs: result.packs,
        skipped: result.skipped,
        engine: 'ansi',
        cssWarnings: [],
      })) {
        adapter.diagnostics(line);
      }
      for (const line of read.problems) adapter.diagnostics(line);
      const failureLines = [
        ...result.skipped
          .filter((entry) => entry.engineUnsupported === undefined)
          .map(skippedPackFolderLine),
        ...read.problems,
      ];
      return {
        kind: 'loaded',
        namespaces: result.namespaces,
        packs: result.packs,
        skipped: result.skipped,
        components: result.components,
        unavailable: result.unavailable,
        scripts: read.scripts,
        failureLines,
      };
    },

    async removePack(namespace: string): Promise<RemovePackResult> {
      const packs = adapter.packs;
      if (!packs?.installRoot || !packs.removeFolder) {
        return unsupported(
          adapter,
          'packs',
          'this host has no pack-install destination configured.',
        );
      }
      const outcome = await removePackViaAdapter(
        adapter,
        namespace,
        packs.installRoot(),
        packs.removeFolder.bind(packs),
        packs.reservedNamespaces(),
      );
      catalogCache.invalidate();
      // The trust entry goes whatever happened to the folder: this device
      // has withdrawn its authorization, so the pack stops loading. Only a
      // refused or malformed request leaves the list alone.
      if (outcome.kind !== 'reserved' && outcome.kind !== 'invalid') {
        await forgetPackTrust(adapter, namespace);
      }
      adapter.diagnostics(removePackDiagnosticLine(outcome));
      return outcome;
    },

    async installedPacks(): Promise<InstalledPacksOutcome> {
      if (!usesPackTrust(adapter)) {
        return unsupported(
          adapter,
          'pack-trust',
          'this host does not gate installed packs on a trust list.',
        );
      }
      return { kind: 'listed', ...(await listInstalledPacks(adapter)) };
    },

    async enablePack(namespace: string): Promise<EnablePackResult> {
      if (!usesPackTrust(adapter)) {
        return unsupported(
          adapter,
          'pack-trust',
          'this host does not gate installed packs on a trust list.',
        );
      }
      const outcome = await enablePackViaAdapter(adapter, namespace);
      catalogCache.invalidate();
      adapter.diagnostics(enablePackDiagnosticLine(outcome));
      return outcome;
    },

    async disablePack(namespace: string): Promise<DisablePackResult> {
      if (!usesPackTrust(adapter)) {
        return unsupported(
          adapter,
          'pack-trust',
          'this host does not gate installed packs on a trust list.',
        );
      }
      const outcome = await disablePackViaAdapter(adapter, namespace);
      catalogCache.invalidate();
      adapter.diagnostics(disablePackDiagnosticLine(outcome));
      return outcome;
    },

    async completeAt(request: EditorPositionRequest): Promise<CompleteOutcome> {
      const editor = adapter.editor;
      if (!editor) {
        return unsupported(
          adapter,
          'editor',
          'completion is not available: this host has no live editor.',
        );
      }
      return completeWith(await catalogCache.get(), request, editor);
    },

    completeAtSync(request: EditorPositionRequest): CompleteOutcome {
      const editor = adapter.editor;
      if (!editor) {
        return unsupported(
          adapter,
          'editor',
          'completion is not available: this host has no live editor.',
        );
      }
      const warm = catalogCache.peek();
      if (warm === undefined) void catalogCache.get();
      return completeWith(warm ?? buildComponentCatalog([]), request, editor);
    },

    invalidateCatalog(): void {
      catalogCache.invalidate();
    },

    async hoverAt(request: EditorPositionRequest): Promise<HoverOutcome> {
      const editor = adapter.editor;
      if (!editor) {
        return unsupported(
          adapter,
          'editor',
          'hover is not available: this host has no live editor.',
        );
      }
      const catalog = await catalogCache.get();
      const hover = hoverAtViaEditor(
        { documentText: () => documentTextFor(editor, request) },
        request,
        catalog,
      );
      if (hover === undefined) return { kind: 'none' };
      // The formatted text (summary, attributes, and the usage example),
      // not the bare summary sentence: a component's description alone
      // often never repeats its own directive name (see
      // `./editor-behavior.js`'s `hoverDocumentationText` doc comment),
      // while the usage example always does.
      return {
        kind: 'hover',
        text: formatComponentDocumentation(hover.documentation),
        documentation: hover.documentation,
        start: hover.start,
        end: hover.end,
      };
    },

    async insertComponent(
      request: InsertComponentRequest,
    ): Promise<InsertOutcome> {
      if (!adapter.editor) {
        return unsupported(
          adapter,
          'editor',
          'insert component is not available: this host has no live editor.',
        );
      }
      const catalog = await currentCatalog();
      const component = catalog.find(
        (entry) => entry.directiveName === request.name,
      );
      if (component === undefined) {
        adapter.diagnostics(
          `insert component: no catalog entry named "${request.name}".`,
        );
        return { kind: 'not-found', name: request.name };
      }

      const cursor = adapter.editor.cursor();
      const documentText = adapter.editor.documentText();
      const plan = insertComponentPlan(
        component,
        documentText,
        cursor.line,
        cursor.column,
      );
      const edits: HostTextEdit[] = plan.edits.map((edit) => ({
        line: edit.line,
        startColumn: edit.startColumn,
        endColumn: edit.endColumn,
        text: edit.text,
      }));
      const applied = await adapter.editor.applyEdits(edits);
      if (!applied) {
        adapter.diagnostics(
          `insert component: the host declined to apply the edit for "${request.name}".`,
        );
        return { kind: 'failed' };
      }
      return { kind: 'inserted', cursor: plan.cursor };
    },

    diagnostics(line: string): void {
      adapter.diagnostics(line);
    },
  };
}
