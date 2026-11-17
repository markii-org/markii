/**
 * `createMarkiiHost`: the behaviors every app calls instead of assembling
 * its own run/export/pack/editor wiring. Everything it touches (files, prompts,
 * the isolate) arrives through the adapter, so the main entry stays
 * environment-neutral. VS Code's webview imports only the pure pieces and
 * never calls this function.
 *
 * It provides `run`, `lastRun`, `forgetGrants`, `diagnostics`, `open`,
 * `exportNote`, `exportLinkedSet`, `installPack`, `loadPacks`, `completeAt`,
 * `hoverAt`, and `insertComponent`, over the behavior modules
 * (`./export-behavior.js`, `./pack-install.js`, `./pack-load.js`,
 * `./editor-behavior.js`). A behavior that needs a capability the adapter
 * lacks returns the shared `Unsupported` outcome with one diagnostics line,
 * so a decline is never a silent no-op ("clean is not silent").
 *
 * Outcome vocabulary, the same in every behavior:
 * `declined` is a user's "no" to a prompt or a cancelled picker; `failed`
 * is an I/O or runtime failure and carries a `reason`; `invalid` is input
 * that was read and judged bad and carries a `reason`; `unsupported` is a
 * host that lacks the capability. No behavior rejects.
 */
import type {
  HostAdapter,
  HostExportFormat,
  HostPackSource,
  HostTextEdit,
} from './adapter.js';
import type { RunResult, SpawnRunRequest } from '../run/run-host.js';
import type { RunTrigger, StoredValue } from '@markii/runtime';
import type { BundleManifest } from '@markii/bundle';
import type { PinPolicy } from '../run/net-pinning.js';
import type { PackModulesMap } from '../run/lua-resolver.js';
import type { ValuesFailure } from '../values-failure.js';
import { readPersistedValues } from '../run/run-flow.js';
import { clearGrantForDocument } from '../run/grant-flow.js';
import { readLastRunTrace, type RunTrace } from '../run/run-trace.js';
import { staleValuesForRehydration } from '../run/stale-values.js';
import type { OnDiagnostic, UnavailableComponent } from '@markii/stdlib';
import type {
  CompletionItem,
  ComponentDocumentation,
  InsertableComponent,
  LineColumn,
} from '@markii/stdlib/editor';
import { runViaAdapter } from './run-behavior.js';
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
import type {
  CascadeLinkResolver,
  CascadeTruncation,
} from '../export/cascade.js';
import { exportBaseName } from '../export/note-export.js';
import {
  exportLinkedSetViaAdapter,
  type CascadeExportedNote,
  type UnreadableCascadeNote,
} from './cascade-export-behavior.js';
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
import type { InstalledPacksListing } from './pack-trust-behavior.js';
import {
  completionPlanAt,
  createCatalogCache,
  hoverAtViaEditor,
  typedOpenerFenceEdits,
  insertComponentPlan,
} from './editor-behavior.js';

/** The shared decline shape every behavior returns when the adapter lacks the capability it needs. */
export interface Unsupported {
  readonly kind: 'unsupported';
  readonly capability:
    | 'isolate'
    | 'editor'
    | 'packs'
    | 'pack-trust'
    | 'export-format'
    | 'linked-set-export';
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

/** Writes one diagnostics line for a rejected adapter primitive and returns the `failed` outcome. Never throws. */
function failedOutcome(
  adapter: HostAdapter,
  what: string,
  err: unknown,
): { readonly kind: 'failed'; readonly reason: string } {
  const reason = err instanceof Error ? err.message : String(err);
  try {
    adapter.diagnostics(`${what} failed: ${reason}`);
  } catch {
    // the diagnostics surface itself is what failed
  }
  return { kind: 'failed', reason };
}

// --- open ------------------------------------------------------------

export interface OpenRequest {
  readonly path: string;
}

export type OpenOutcome =
  | { readonly kind: 'opened'; readonly text: string }
  | { readonly kind: 'failed'; readonly reason: string };

// --- run -------------------------------------------------------------

export interface RunRequest {
  /** Stable identity for the note this run belongs to. The same key reads the run back through `lastRun` and clears its grants through `forgetGrants`. */
  readonly documentKey: string;
  readonly text: string;
  readonly trigger: RunTrigger;
  /** The address policy for the run's network access. Omitted keeps the fail-closed default, which refuses private and loopback addresses. */
  readonly netPolicy?: PinPolicy;
  /** Present only for a bundle-backed note. */
  readonly bundle?: {
    readonly manifest: BundleManifest;
    /** Called once per run, before the grant flow, to read the bundle's files. */
    readonly buildSnapshot: () => Promise<Record<string, Uint8Array>>;
    /** Receives the bundle's `.cache/` subtree after a run that produced one. */
    readonly persistCacheOut: (
      cacheOut: Record<string, Uint8Array>,
    ) => Promise<void>;
  };
  /** Pre-read pack Lua modules, so a script's `require` of a pack module resolves. Omit it when no packs are loaded. */
  readonly packModules?: PackModulesMap;
  /** Called once per script as its value arrives, already scrubbed for the wire. */
  readonly onValue?: (name: string, value: StoredValue) => void;
  /** The wall-clock budget for the run. Defaults to 15 seconds. */
  readonly timeoutMs?: number;
}

export type RunOutcome =
  | {
      readonly kind: 'ran';
      readonly values: Record<string, StoredValue>;
      readonly failures: ValuesFailure[];
      /** The same failures with their messages, for the diagnostics surface only. */
      readonly failureDetails: {
        name: string;
        kind: ValuesFailure['kind'];
        message: string;
      }[];
      /** Lines describing a mismatch between declared and reached hosts, for the diagnostics surface only. */
      readonly netDeclarationDiagnostics: string[];
      /** The outcome this run recorded, for the in-note marker. */
      readonly trace: RunTrace;
      /** How many of this run's values came back `fresh`. */
      readonly freshCount: number;
      /** How many of this run's values came back `error`. */
      readonly errorCount: number;
    }
  /** The run threw. The diagnostics line and a failed trace are already written. */
  | { readonly kind: 'failed'; readonly reason: string }
  | Unsupported;

/** What a note's last run left in the adapter's memento. */
export interface LastRunOutcome {
  /** The stored values marked for showing on open: a `fresh` value reads `stale` until a new run lands. Empty when nothing is stored. */
  readonly values: Record<string, StoredValue>;
  /** The stored values exactly as persisted, for an export that bakes a snapshot in. Empty when nothing is stored. */
  readonly persistedValues: Record<string, StoredValue>;
  /** The last run's recorded outcome, absent when nothing is stored. */
  readonly trace?: RunTrace;
}

// --- export ------------------------------------------------------------

/** The render options a single-note export and a linked-set export share. */
export interface ExportRenderOptions {
  /**
   * Installed pack components the static HTML engine cannot draw. A
   * directive naming one is labeled "no HTML view" instead of "unknown
   * component" in the exported file. Used only when the static engine
   * renders the body.
   */
  readonly unavailableComponents?: readonly UnavailableComponent[];
  /** Receives the static engine's render diagnostics, such as the `no-engine-view` event. */
  readonly onDiagnostic?: OnDiagnostic;
  /** The host's own render of the body (a React pass bound to its loaded packs). Omitted means the static engine renders, and `staticReason` says why. */
  readonly renderBody?: ExportBodyRenderer;
  /** Why the static engine renders when `renderBody` is omitted. Defaults to `no-packs`. */
  readonly staticReason?: StaticExportReason;
  /** The loaded packs' stylesheets, embedded only when `renderBody` ran. */
  readonly packStylesheets?: readonly ExportPackStylesheet[];
  /** How many loaded packs contributed to the render. Diagnostics only. */
  readonly packCount?: number;
  /** Hides the collapsed script marker in the exported file. Defaults to `false`. */
  readonly hideScriptBlocks?: boolean;
}

export interface ExportRequest extends ExportRenderOptions {
  readonly format: HostExportFormat;
  /** The note's own path, used to name the exported file. */
  readonly notePath: string;
  readonly text: string;
  /** The note's last-run values, baked into an html/pdf export. Omitted or empty exports the note's standard empty states. */
  readonly values?: Record<string, StoredValue>;
  /** Reads one of the note's local images so the export embeds it as a `data:` URI. Omitted leaves every image source as written. */
  readonly embedImages?: ExportImageReader;
  /** Where to write the file. When present the adapter's `resolveTarget` is not asked. */
  readonly targetPath?: string;
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
  /** The picker was cancelled, or a seam this host declared (`htmlToPdf`, an injected `renderAnsi`) was not wired up at the moment of export. Nothing was written. */
  | { readonly kind: 'declined' }
  | Unsupported;

// --- linked-set export -----------------------------------------------------

export interface ExportLinkedSetRequest extends ExportRenderOptions {
  /** The root note's path, in whatever form `adapter.readFile` and `resolveLink` understand. */
  readonly rootPath: string;
  /** Resolves one link in a note to the path of a note this host can export, or `undefined` to leave the link as written. */
  readonly resolveLink: CascadeLinkResolver;
  /** Reads one note's persisted last-run values, keyed by that note's own path. An empty object exports that note's standard empty states. */
  readonly readValues: (notePath: string) => Record<string, StoredValue>;
  /** Builds the image reader for one note, bound to that note's own folder. Omitted embeds no images. */
  readonly embedImagesFor?: (notePath: string) => ExportImageReader;
  /** Where to write the archive. When present the adapter's `resolveLinkedSetTarget` is not asked. */
  readonly targetPath?: string;
}

export type ExportLinkedSetOutcome =
  | {
      readonly kind: 'exported';
      /** The written archive's display path. */
      readonly path: string;
      readonly bytes: number;
      /** Every note the archive contains, breadth first, the root note first. */
      readonly notes: readonly CascadeExportedNote[];
      /** Notes a link pointed at that could not be read. */
      readonly unreadable: readonly UnreadableCascadeNote[];
      /** Set when a bound stopped the walk before it ran out of links to follow. */
      readonly truncated?: CascadeTruncation;
    }
  | { readonly kind: 'failed'; readonly path?: string; readonly reason: string }
  /** The host's picker was cancelled, so nothing was written. */
  | { readonly kind: 'declined' }
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
  /** The archive was read and judged bad: it is not a valid pack archive. Nothing was written. */
  | { readonly kind: 'invalid'; readonly reason: string }
  /** A prompt, a check or a write failed. */
  | { readonly kind: 'failed'; readonly reason: string }
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
  /** An adapter primitive rejected while the packs were read. The diagnostics line is already written. */
  | { readonly kind: 'failed'; readonly reason: string }
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
  /** An adapter primitive rejected while the packs were read. The diagnostics line is already written. */
  | { readonly kind: 'failed'; readonly reason: string }
  | Unsupported;

export type RemovePackOutcome =
  | { readonly kind: 'removed'; readonly namespace: string }
  | { readonly kind: 'not-installed'; readonly namespace: string }
  | { readonly kind: 'reserved'; readonly namespace: string }
  /** The namespace is not a valid pack name. */
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string }
  | Unsupported;

export type InstalledPacksOutcome =
  | ({ readonly kind: 'listed' } & InstalledPacksListing)
  /** An adapter primitive rejected while the install root was read. The diagnostics line is already written. */
  | { readonly kind: 'failed'; readonly reason: string }
  | Unsupported;

export type EnablePackOutcome =
  | { readonly kind: 'enabled'; readonly namespace: string }
  /** The user refused the consent prompt. */
  | { readonly kind: 'declined'; readonly namespace: string }
  | { readonly kind: 'not-installed'; readonly namespace: string }
  | { readonly kind: 'reserved'; readonly namespace: string }
  /** The namespace is not a valid pack name. */
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string }
  | Unsupported;

export type DisablePackOutcome =
  | { readonly kind: 'disabled'; readonly namespace: string }
  | { readonly kind: 'not-enabled'; readonly namespace: string }
  /** The namespace is not a valid pack name. */
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string }
  | Unsupported;

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

export interface TypedOpenerRequest {
  /** Zero-based line the author just finished typing. */
  readonly line: number;
  /** The document the line belongs to. Omitted, the adapter's own `editor.documentText()` is read. */
  readonly documentText?: string;
}

export type TypedOpenerOutcome =
  /** Fence lines to lengthen, in pre-edit coordinates, to apply in one undo step. The typed line itself is never in the list. */
  | {
      readonly kind: 'fence-edits';
      readonly fenceEdits: readonly HostTextEdit[];
    }
  /** The line is not a container opener inside another container, or nothing needs to grow. Not a failure. */
  | { readonly kind: 'none' }
  | { readonly kind: 'failed'; readonly reason: string }
  | Unsupported;

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
  /** The editor or the catalog threw. The diagnostics line is already written. */
  | { readonly kind: 'failed'; readonly reason: string }
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
  /** The editor or the catalog threw. The diagnostics line is already written. */
  | { readonly kind: 'failed'; readonly reason: string }
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
  /** The edit was not applied, or the editor or the catalog threw. The diagnostics line is already written. */
  | { readonly kind: 'failed'; readonly reason: string }
  | Unsupported;

// --- the host itself ---------------------------------------------------

export interface MarkiiHost {
  open(request: OpenRequest): Promise<OpenOutcome>;
  run(request: RunRequest): Promise<RunOutcome>;
  /**
   * What the last run of `documentKey` left in the adapter's memento: the
   * values as they should be shown on open, the values as stored, and the
   * recorded trace. Empty when nothing is stored. Synchronous, because the
   * memento read is.
   */
  lastRun(documentKey: string): LastRunOutcome;
  /** Clears the stored script grants of `documentKey`, so its next manual run prompts again for every host. Nothing stored is not an error. */
  forgetGrants(documentKey: string): Promise<void>;
  exportNote(request: ExportRequest): Promise<ExportOutcome>;
  /** Exports a note and the notes it links to as one zip archive of HTML files. */
  exportLinkedSet(
    request: ExportLinkedSetRequest,
  ): Promise<ExportLinkedSetOutcome>;
  installPack(request: InstallPackRequest): Promise<InstallPackOutcome>;
  loadPacks(): Promise<LoadPacksOutcome>;
  /**
   * `loadPacks` for a host running the terminal engine: also reads each
   * pack's `terminal.js`. Unsupported unless the adapter's pack source
   * declares the `ansi` engine.
   */
  loadTerminalPacks(): Promise<LoadTerminalPacksOutcome>;
  /** Removes one installed pack by namespace, through the install root. Writes its outcome to the diagnostics surface. Under `trust: 'device-list'` it also withdraws the namespace's trust entry. */
  removePack(namespace: string): Promise<RemovePackOutcome>;
  /**
   * Under `trust: 'device-list'`: the install root's folders split into the
   * ones this device has enabled and the ones merely present. Unsupported
   * for a host that does not declare the trust list.
   */
  installedPacks(): Promise<InstalledPacksOutcome>;
  /** Asks the install consent prompt, then trusts an installed folder on this device. Unsupported without the trust list. */
  enablePack(namespace: string): Promise<EnablePackOutcome>;
  /** Withdraws a namespace's trust entry and leaves its folder in place. Unsupported without the trust list. */
  disablePack(namespace: string): Promise<DisablePackOutcome>;
  completeAt(request: EditorPositionRequest): Promise<CompleteOutcome>;
  /**
   * `completeAt` for a caller that must answer synchronously (Obsidian's
   * `EditorSuggest.onTrigger`). Reads the cached catalog; while the cache
   * is cold it answers from the standard set and starts warming the cache,
   * so the next request sees installed packs.
   */
  completeAtSync(request: EditorPositionRequest): CompleteOutcome;
  /**
   * The fence lengthening a hand-typed container opener needs. A host calls
   * it after the author finishes a line, for an edit the author typed and
   * never for undo, redo or a pasted block, and applies the edits in one
   * undo step.
   */
  typedOpenerAt(request: TypedOpenerRequest): TypedOpenerOutcome;
  /** Drops the cached completion/hover catalog, for a host whose pack folders just changed. `installPack` and `loadPacks` do this themselves. */
  invalidateCatalog(): void;
  hoverAt(request: EditorPositionRequest): Promise<HoverOutcome>;
  insertComponent(request: InsertComponentRequest): Promise<InsertOutcome>;
  diagnostics(line: string): void;
}

/**
 * What an outside host may pass to `createMarkiiHost`. Neither field
 * changes what a behavior decides; each supplies an engine this package
 * never imports itself.
 */
export interface MarkiiHostOptions {
  /** The static HTML engine behind the `html` and `pdf` exports (`createHtmlExportEngine()` from `@markii/host/html-engine`). Without it those formats decline, like `renderAnsi` for `ansi`. */
  readonly htmlEngine?: HtmlExportEngine;
  /** `@markii/ansi`'s renderer, injected because this package never depends on `@markii/ansi` (a platform renderer, never a `@markii/host` dependency). A host declaring `'ansi'` in `adapter.exports.formats` without supplying this gets `Unsupported` at export time. */
  readonly renderAnsi?: (text: string) => Promise<string>;
}

/**
 * The test seams of `createMarkiiHostWithSeams`, which `@markii/host/internal`
 * exports. They make a run or a pack discovery deterministic. Defaults are
 * the real implementations.
 */
export interface MarkiiHostSeams extends MarkiiHostOptions {
  readonly spawnRun?: (options: SpawnRunRequest) => Promise<RunResult>;
  /** Pack discovery's file reads. Defaults to reads through the adapter's own `readFile` and `listFolder`. */
  readonly packDiscoveryIo?: PackDiscoveryIo;
}

export function createMarkiiHost(
  adapter: HostAdapter,
  options: MarkiiHostOptions = {},
): MarkiiHost {
  return createMarkiiHostWithSeams(adapter, options);
}

/** `createMarkiiHost` with the test seams. Exported from `@markii/host/internal` only. */
export function createMarkiiHostWithSeams(
  adapter: HostAdapter,
  options: MarkiiHostSeams = {},
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
  async function readCatalog(): Promise<readonly InsertableComponent[]> {
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

  /** The catalog for the cache. A rejected pack read writes one diagnostics line and leaves the standard set, so completion and hover still answer. */
  async function currentCatalog(): Promise<readonly InsertableComponent[]> {
    try {
      return await readCatalog();
    } catch (err) {
      failedOutcome(adapter, 'read the pack catalog', err);
      return buildComponentCatalog([]);
    }
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
      try {
        return await runViaAdapter(adapter, request, options.spawnRun);
      } catch (err) {
        // `runViaAdapter` reports a throwing run as `failed` itself. This
        // catches only what threw outside it, so `run` never rejects.
        const reason = err instanceof Error ? err.message : String(err);
        try {
          adapter.diagnostics(`run failed: ${reason}`);
        } catch {
          // the diagnostics surface itself is what failed
        }
        return { kind: 'failed', reason };
      }
    },

    lastRun(documentKey: string): LastRunOutcome {
      const persistedValues = readPersistedValues(adapter.memento, documentKey);
      const trace = readLastRunTrace(adapter.memento, documentKey);
      return {
        values: staleValuesForRehydration(persistedValues),
        persistedValues,
        ...(trace !== undefined ? { trace } : {}),
      };
    },

    forgetGrants(documentKey: string): Promise<void> {
      return clearGrantForDocument(adapter.memento, documentKey);
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

      if (
        request.targetPath === undefined &&
        adapter.exports?.resolveTarget === undefined
      ) {
        return unsupported(
          adapter,
          'export-format',
          `export format "${request.format}" has no destination on ${adapter.id}: the host declares no resolveTarget and the request has no targetPath.`,
        );
      }

      const outcome = await exportNoteFileViaAdapter(
        adapter,
        request.format,
        {
          ...(request.targetPath !== undefined
            ? { targetPath: request.targetPath }
            : {}),
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
        return { kind: 'declined' };
      }

      for (const line of exportDiagnosticLines(outcome, adapter.labels)) {
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

    async exportLinkedSet(
      request: ExportLinkedSetRequest,
    ): Promise<ExportLinkedSetOutcome> {
      // A host offers the linked-set export when it declares `exports` and
      // either names a `resolveLinkedSetTarget` or gets a `targetPath` with
      // the request.
      if (
        adapter.exports === undefined ||
        (request.targetPath === undefined &&
          adapter.exports.resolveLinkedSetTarget === undefined)
      ) {
        return unsupported(
          adapter,
          'linked-set-export',
          `the linked-set export is not available on ${adapter.id}.`,
        );
      }
      if (options.htmlEngine === undefined) {
        return unsupported(
          adapter,
          'linked-set-export',
          'no HTML export engine was supplied, so the linked-set export cannot render.',
        );
      }
      const outcome = await exportLinkedSetViaAdapter(adapter, {
        ...request,
        engine: options.htmlEngine,
        suggestedFileName: `${exportBaseName(request.rootPath)}.zip`,
      });
      if (outcome === undefined) {
        adapter.diagnostics(
          `linked-set export declined: no archive target was chosen on ${adapter.id}.`,
        );
        return { kind: 'declined' };
      }
      return outcome;
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
      const removeFolder = adapter.packs.removeFolder;
      if (removeFolder === undefined) {
        return unsupported(
          adapter,
          'packs',
          'this host has no way to remove an installed pack folder.',
        );
      }

      const outcome = await installPackFromArchive(adapter, {
        archiveBytes: request.archiveBytes,
        archivePath,
        installRoot: adapter.packs.installRoot(),
        exists: (path) => adapter.exists(path),
        removeFolder: (path) => removeFolder.call(adapter.packs, path),
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
      try {
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
              notEnabledPackDiagnosticLine(
                namespace,
                adapter.labels.deviceNoun,
              ),
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
      } catch (err) {
        return failedOutcome(adapter, 'load packs', err);
      }
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
      try {
        const result = await loadPacksViaAdapter(
          packSource(adapter.packs),
          packIo,
        );
        const read = await readTerminalPackScripts(
          adapter,
          result.packs,
          adapter.labels,
        );
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
      } catch (err) {
        return failedOutcome(adapter, 'load terminal packs', err);
      }
    },

    async removePack(namespace: string): Promise<RemovePackOutcome> {
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
      try {
        return { kind: 'listed', ...(await listInstalledPacks(adapter)) };
      } catch (err) {
        return failedOutcome(adapter, 'list installed packs', err);
      }
    },

    async enablePack(namespace: string): Promise<EnablePackOutcome> {
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

    async disablePack(namespace: string): Promise<DisablePackOutcome> {
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
      try {
        return completeWith(await catalogCache.get(), request, editor);
      } catch (err) {
        return failedOutcome(adapter, 'completion', err);
      }
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
      try {
        const warm = catalogCache.peek();
        if (warm === undefined) {
          catalogCache.get().catch((err: unknown) => {
            failedOutcome(adapter, 'completion catalog', err);
          });
        }
        return completeWith(warm ?? buildComponentCatalog([]), request, editor);
      } catch (err) {
        failedOutcome(adapter, 'completion', err);
        return { kind: 'none' };
      }
    },

    typedOpenerAt(request: TypedOpenerRequest): TypedOpenerOutcome {
      const editor = adapter.editor;
      if (!editor) {
        return unsupported(
          adapter,
          'editor',
          'fence lengthening is not available: this host has no live editor.',
        );
      }
      try {
        const fenceEdits = typedOpenerFenceEdits(
          request.documentText ?? editor.documentText(),
          request.line,
        );
        return fenceEdits.length === 0
          ? { kind: 'none' }
          : { kind: 'fence-edits', fenceEdits };
      } catch (err) {
        return failedOutcome(adapter, 'fence lengthening', err);
      }
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
      try {
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
      } catch (err) {
        return failedOutcome(adapter, 'hover', err);
      }
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
      try {
        const catalog = await readCatalog();
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
          const reason = 'the host declined to apply the edit';
          adapter.diagnostics(
            `insert component: the host declined to apply the edit for "${request.name}".`,
          );
          return { kind: 'failed', reason };
        }
        return { kind: 'inserted', cursor: plan.cursor };
      } catch (err) {
        return failedOutcome(adapter, 'insert component', err);
      }
    },

    diagnostics(line: string): void {
      adapter.diagnostics(line);
    },
  };
}
