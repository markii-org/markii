/**
 * `createMarkiiHost`: the behaviors every app calls instead of assembling
 * its own run/export/pack/editor wiring. Behind the main entry only (it
 * reaches packs, the filesystem, and the isolate) — VS Code's webview
 * stays on `@markii/host/browser`'s pure pieces and never sees this
 * function (`tmp/W11-adapter-design.md`, section 1).
 *
 * Phase 1a implemented `run`, `diagnostics`, and `open`. This phase
 * (1b) fills in `exportNote`, `installPack`, `loadPacks`, `completeAt`,
 * `hoverAt`, and `insertComponent`, over the behavior modules built in
 * this same pass (`./export-behavior.js`, `./pack-install.js`,
 * `./pack-load.js`, `./editor-behavior.js`). Every one of them still
 * returns the shared `Unsupported` outcome, with one diagnostics line,
 * when the adapter lacks the capability it needs — AGENTS.md's "clean is
 * not silent": a decline is never a silent no-op.
 */
import type { HostAdapter, HostExportFormat, HostTextEdit } from './adapter.js';
import type { RunResult, SpawnRunOptions } from '../run/run-host.js';
import type { StoredValue } from '@markii/runtime';
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
import {
  createNodeArchiveExtractFs,
  type ArchiveExtractFs,
} from './pack-archive.js';
import {
  installPackDiagnosticLines,
  installPackFromArchive,
} from './pack-install.js';
import { loadPacksViaAdapter } from './pack-load.js';
import { buildComponentCatalog } from '../insert/component-catalog.js';
import { formatPackDiagnosticLines } from '../packs/pack-diagnostics.js';
import { formatComponentDocumentation } from '@markii/stdlib/editor';
import {
  exportDiagnosticLines,
  exportNoteFileViaAdapter,
} from './export-behavior.js';
import {
  completionPlanAt,
  createCatalogCache,
  hoverAtViaEditor,
  insertComponentPlan,
} from './editor-behavior.js';

/** The shared decline shape every behavior returns when the adapter lacks the capability it needs. */
export interface Unsupported {
  readonly kind: 'unsupported';
  readonly capability: 'isolate' | 'editor' | 'packs' | 'export-format';
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
}

export type ExportOutcome =
  | { readonly kind: 'exported'; readonly path: string; readonly bytes: number }
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
  | { readonly kind: 'loaded'; readonly namespaces: readonly string[] }
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
  readonly spawnRun?: (options: SpawnRunOptions) => Promise<RunResult>;
  /** The `.mkp` extraction filesystem `installPack` writes through. Defaults to the real, Node-backed one. Injected for a test that wants to observe or fail a write. */
  readonly archiveExtractFs?: ArchiveExtractFs;
  /** `@markii/ansi`'s renderer, injected because this package never depends on `@markii/ansi` (a platform renderer, never a `@markii/host` dependency). A host declaring `'ansi'` in `adapter.exports.formats` without supplying this gets `Unsupported` at export time. */
  readonly renderAnsi?: (text: string) => Promise<string>;
  /** Composes a pack-aware render registry (webview registration, in-process evaluation, ...). Reserved for a future slice that renders through `exportNote`'s `html` path with packs; unused today, since `buildExportDocument`'s default (no `renderBody`) already produces a correct, pack-free static export. */
  readonly buildPackRegistration?: unknown;
}

export function createMarkiiHost(
  adapter: HostAdapter,
  options: MarkiiHostOptions = {},
): MarkiiHost {
  /** The pack-aware insert/completion catalog, built fresh from this host's currently authorized folders. Not cached here: `./editor-behavior.js`'s `createCatalogCache` is the caching seam, and a caller wiring a live editor (repeated completion/hover calls per keystroke) is expected to wrap this call in one. */
  async function currentCatalog(): Promise<readonly InsertableComponent[]> {
    if (!adapter.packs) return buildComponentCatalog([]);
    const { packs } = await loadPacksViaAdapter(adapter.packs);
    return buildComponentCatalog(
      [...(adapter.packs.bundledPacks?.() ?? []), ...packs],
      adapter.packs.engine ?? 'react',
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
          notePath: request.notePath,
          text: request.text,
          ...(request.values !== undefined ? { values: request.values } : {}),
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
      return { kind: 'exported', path: outcome.path, bytes: outcome.bytes };
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
      const extractFs =
        options.archiveExtractFs ?? createNodeArchiveExtractFs();

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

      if (outcome.kind === 'installed') {
        return {
          kind: 'installed',
          namespace: outcome.packName,
          replaced: outcome.replaced,
        };
      }
      if (outcome.kind === 'declined') {
        return {
          kind: 'declined',
          step: outcome.step,
          namespace: outcome.packName,
        };
      }
      if (outcome.kind === 'reserved') {
        return { kind: 'reserved', namespace: outcome.packName };
      }
      return { kind: 'rejected', reason: outcome.reason };
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
      const result = await loadPacksViaAdapter(adapter.packs);
      for (const line of formatPackDiagnosticLines({
        packs: result.packs,
        skipped: result.skipped,
        cssWarnings: [],
      })) {
        adapter.diagnostics(line);
      }
      return { kind: 'loaded', namespaces: result.namespaces };
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
