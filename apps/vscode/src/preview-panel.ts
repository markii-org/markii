import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  BundleFsGrant,
  BundleManifest,
  BundleStorage,
} from '@markii/bundle';
import { openZipBundle } from '@markii/bundle';
import { openDirBundle } from '@markii/bundle/fs';
import {
  bundlePreviewTitleFor,
  classifyBundleTarget,
} from './bundle-target.js';
import {
  bundleResolutionFailureMessage,
  extractAssetsAsDataUris,
  resolveBundleDocument,
  zipArchiveTooLarge,
} from './bundle-resolve.js';
import type { BundleResolution } from './bundle-resolve.js';
import { createDebouncer } from './debounce.js';
import { isPreviewableDocument, previewTitleFor } from './mark-document.js';
import {
  EXPORT_HTML_FILTERS,
  EXPORT_HTML_NO_DOCUMENT_MESSAGE,
  EXPORT_HTML_REVEAL_LABEL,
  EXPORT_HTML_SAVE_DIALOG_TITLE,
  EXPORT_HTML_SAVE_LABEL,
  exportHtmlDefaultFileName,
  exportHtmlDiagnosticLines,
  exportHtmlResultMessage,
} from './export-html.js';
import type { HtmlExportOutcome } from './export-html.js';
import { isWebviewToHostMessage } from './protocol.js';
import type {
  ExportRequestMessage,
  HostToWebviewMessage,
  PackDiagnosticsMessage,
  ValuesMessage,
} from './protocol.js';
import { packExportStylesheets } from './packs/pack-export-styles.js';
import {
  isCoveredByRoots,
  packWebviewRoots,
  withTrailingSlash,
} from './resource-roots.js';
import { buildWebviewHtml, createNonce } from './webview-html.js';
import {
  ALLOW_LABEL,
  DONT_ALLOW_LABEL,
  UNKNOWN_HOSTS_PROMPT_MESSAGE,
  bundleAccessPromptMessage,
  clearGrantForDocument,
  hostPromptMessage,
  manyHostsPromptMessage,
  spawnRun as spawnRunHost,
  readPersistedValues,
  runOnce,
  staleValuesForRehydration,
  readLastRunTrace,
  writeLastRunTrace,
  buildBundleSnapshot,
  decodeBundleCacheFromStorage,
  encodeBundleCacheForStorage,
  withPersistedCache,
  buildPackRegistrationScript,
  buildNoteExport,
} from '@markii/host';
import type {
  ExportBodyResult,
  RunResult,
  SpawnRunOptions,
} from '@markii/host';
import { resolveWorkerPath } from './worker-path.js';
import type { RunTrigger, StoredValue } from '@markii/runtime';
import { MIN_REFRESH_INTERVAL_SECONDS } from './refresh-interval.js';
import { loadPackContext } from './packs/pack-context.js';
import type { PackContext } from './packs/pack-context.js';
import {
  formatPackDiagnosticLines,
  formatPackRegistrationDiagnosticLines,
  skippedPackCount,
} from './packs/pack-diagnostics.js';

/**
 * Imports `vscode` — deliberately NOT unit-tested (vitest cannot resolve
 * `vscode`), per the extension's file-scope split. Every piece of logic
 * worth testing in isolation (message validation, debouncing, document
 * classification, bundle resolution, HTML/CSP construction) already lives
 * in the plain modules imported above; this file is wiring and I/O only.
 */

const VIEW_TYPE = 'markii.preview';
/** External wall-clock budget for one `markii.runScripts` press — forwarded verbatim to `spawnRun`'s own watchdog (`@markii/host`'s `run/run-host.ts`); the worker cannot influence or extend it. */
const RUN_TIMEOUT_MS = 15_000;

/**
 * This extension's own `spawnRun` adapter: `@markii/host`'s `spawnRun`
 * (`spawnRunHost`, imported above) takes an explicit `workerPath` rather
 * than guessing a host's bundle layout — see that package's `run-host.ts`
 * doc comment. `./worker-path.ts`'s `resolveWorkerPath` is THIS
 * extension's answer for the packaged case (`dist/run/worker.js`); when it
 * returns `undefined` (dev/Vitest, no `dist/` built yet), the explicit
 * `undefined` still reaches `spawnRunHost` and its own `defaultWorkerPath`
 * dev fallback (the sibling `worker-entry.ts` run via `tsx`) takes over,
 * exactly as it did before this adapter existed.
 */
function spawnRun(options: SpawnRunOptions): Promise<RunResult> {
  return spawnRunHost({
    ...options,
    workerPath: options.workerPath ?? resolveWorkerPath(),
  });
}
/** The `when`-clause context key `package.json`'s `markii.runScripts` menu entries gate on — kept in sync with true whenever a preview panel exists, false once it's disposed. */
const PREVIEW_ACTIVE_CONTEXT_KEY = 'markii.previewActive';
/**
 * The webview DOCUMENT's `<title>` — never visible in the editor (the tab
 * label is `panel.title`, set per document by `postUpdate`), but it is what
 * the webview developer-tools window and screen readers announce.
 */
const DOCUMENT_TITLE = 'Markii Preview';
const DEBOUNCE_MS = 200; // matches apps/playground/src/App.tsx's DEBOUNCE_MS

/**
 * What the preview panel is currently showing. `document` is the ordinary
 * v1 case (a plain `.mk.md` file OR a directory-form bundle's contained
 * `note.mk.md`, which is a normal editable file either way — see
 * `openDirectoryBundle`). `bundle-archive` is a read-only zip-form bundle:
 * there is no editable buffer behind it, so it carries its own static text
 * and embedded asset map instead of a `vscode.TextDocument`.
 * `bundle-error` is the quiet degraded state for a bundle that could not be
 * resolved into something previewable at all (AGENTS.md's cleanliness
 * principle: a message in the preview, never a crash or a dump).
 */
/**
 * Slice 2 of the `.mkz` Run-path arc (GitHub issue #9): what a bundle-backed
 * `document`/`bundle-archive` source needs for `markii.runScripts` to run
 * its scripts with the bundle-fs capability — see that command's own doc
 * comment. `rootDir` (directory form) lets a run persist `.cache/` writes
 * straight back into the bundle directory on disk; `storage`/`identity`
 * (zip form) let a run reuse the already-open in-memory archive and
 * persist `.cache/` writes to extension storage keyed by the archive's own
 * identity, without ever rewriting the user's zip file.
 */
type BundleRunContext =
  | {
      readonly form: 'directory';
      readonly manifest: BundleManifest;
      readonly rootDir: string;
    }
  | {
      readonly form: 'zip';
      readonly manifest: BundleManifest;
      readonly storage: BundleStorage;
      readonly identity: string;
    };

type PreviewSource =
  | {
      readonly kind: 'document';
      document: vscode.TextDocument;
      /** Set only for a directory-form bundle's contained document — absent for a plain, bundle-free `.mk.md` file. */
      readonly bundle?: Extract<BundleRunContext, { form: 'directory' }>;
    }
  | {
      readonly kind: 'bundle-archive';
      readonly text: string;
      readonly assets: Readonly<Record<string, string>>;
      readonly title: string;
      readonly bundle: Extract<BundleRunContext, { form: 'zip' }>;
    }
  | {
      readonly kind: 'bundle-error';
      readonly title: string;
      readonly message: string;
    };

interface ActivePreview {
  readonly panel: vscode.WebviewPanel;
  source: PreviewSource;
  revision: number;
  /** `scheme://authority/path` keys of the `localResourceRoots` this panel was created with — see `retargetToDocument`. Fixed for the panel's whole life, because `localResourceRoots` itself is. */
  readonly rootKeys: readonly string[];
  /**
   * The `markii.packs` install state this panel was created with (GitHub
   * issue #3 slice 5) — the webview's registration script URIs and
   * `localResourceRoots` entries were built from this snapshot, and
   * `runScripts` reuses its `packModules` for the Run path's
   * `PackModuleResolver` without re-reading disk on every run. A setting
   * change only takes effect on the next panel (re)creation, exactly like
   * `localResourceRoots` itself already only takes effect that way (see
   * `retargetToDocument`'s doc comment).
   */
  readonly packContext: PackContext;
  /** `context.workspaceState`, kept so `postUpdate` can re-seed a note's persisted last-known values (GitHub issue #11, gap 1) without threading `context` through every navigation path. */
  readonly memento: vscode.Memento;
  readonly debouncer: ReturnType<typeof createDebouncer<void>>;
  /**
   * Set for the duration of one `markii.runScripts` press. `runScripts`
   * below IGNORES a press that arrives while this is already `true` —
   * chosen over cancel-and-restart because a run's cache-snapshot mutation
   * (`run/run-flow.ts`'s `runOnce`) is only safe to persist once a run has
   * fully finished; cancelling mid-run would leave no well-defined snapshot
   * to write back.
   */
  running: boolean;
  /**
   * GitHub issue #11 (scheduled refresh): the interval timer driving
   * `'scheduled'`-trigger re-runs, when `markii.refreshIntervalSeconds` is
   * set above zero at this panel's creation. `undefined` when refresh is
   * off. Cleared in `onDidDispose` so a torn-down panel never keeps firing.
   * Like `packContext`/`localResourceRoots`, the interval is read once at
   * (re)creation; changing the setting takes effect on the next panel.
   */
  refreshTimer?: ReturnType<typeof setInterval>;
  /**
   * GitHub issue #11 (run-on-open): set true once this panel has performed
   * its at-most-once `'auto'`-trigger run-on-open, so the run happens a
   * single time per panel life and NOT again on every hide/show rehydration
   * (the webview re-sends `ready` each time it is rebuilt under
   * `retainContextWhenHidden: false`).
   */
  ranOnOpen: boolean;
}

/** The stable storage identity for a preview source — a plain document's URI, or a zip-form bundle's archive identity. A `bundle-error` source has nothing runnable and thus no key. */
function documentKeyForSource(source: PreviewSource): string | undefined {
  if (source.kind === 'document') return source.document.uri.toString();
  if (source.kind === 'bundle-archive') return source.bundle.identity;
  return undefined;
}

/** The comparable key form of a URI for `resource-roots.ts` — scheme and authority included, so a `file:` root can never be mistaken for a same-path root on another scheme or remote authority. */
function rootKey(uri: vscode.Uri): string {
  return `${uri.scheme}://${uri.authority}${uri.path}`;
}

/**
 * The folder the document lives in, or `undefined` when it has none — an
 * `untitled:` buffer has never been written anywhere, so there is no folder
 * for its relative images to resolve against. Callers degrade to "no base
 * URI" in that case; remote/absolute images keep working regardless.
 */
function documentFolder(document: vscode.TextDocument): vscode.Uri | undefined {
  if (document.uri.scheme === 'untitled') return undefined;
  return vscode.Uri.joinPath(document.uri, '..');
}

/** The last path segment of a URI's path, or `''` for one with none. */
function baseName(uri: vscode.Uri): string {
  return uri.path.split('/').pop() ?? '';
}

/** The tab title for `source`, before any per-update refresh (`postUpdate` re-sets the same value on every message, since a document's own base name can change under a save-as). */
function titleForSource(source: PreviewSource): string {
  return source.kind === 'document'
    ? previewTitleFor(source.document.uri.path)
    : source.title;
}

/**
 * The panel's `localResourceRoots`: the bundled webview assets, every
 * workspace folder, and (for a `document` source) the previewed document's
 * own folder — which, for a directory-form bundle, IS the bundle root, so
 * `assets/nice.png` resolves exactly like any other relative image with no
 * extra code (see `openDirectoryBundle`). A `bundle-archive`/`bundle-error`
 * source needs no extra root: its images (if any) arrive pre-embedded as
 * `data:` URIs (`protocol.ts`'s `UpdateMessage.assets`), not served as
 * local files.
 *
 * DECISION — roots are set BROADLY at creation, and the panel is recreated
 * (`retargetToDocument`) only when the preview follows the editor somewhere
 * no root covers. `localResourceRoots` cannot be widened after creation, so
 * the alternatives were: (a) recreate the panel on every document switch —
 * correct but visibly destroys and rebuilds the preview constantly; (b)
 * grant a very wide root such as the file-system root — one line, and an
 * open door from any previewed note to any file on the machine; (c) this.
 */
/**
 * GitHub issue #3 slice 5: adds ONE root per pack that actually ships a
 * `webview.js` registration script (`packContext.webviewPacks`) — never a
 * broader root, and never anything derived from the previewed document. A
 * pack folder becomes loadable ONLY because it is named by the
 * `markii.packs` setting (an application-scope, user-only setting — see
 * `package.json` — never settable from a workspace's own
 * `.vscode/settings.json`), exactly the same "explicit user trust decision,
 * not content-derived" boundary `localResourceRootsFor`'s existing roots
 * already draw for workspace folders and the previewed document's own
 * folder.
 */
function localResourceRootsFor(
  context: vscode.ExtensionContext,
  source: PreviewSource,
  packContext: PackContext,
): vscode.Uri[] {
  const roots: vscode.Uri[] = [
    vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
  ];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.push(folder.uri);
  }
  if (source.kind === 'document') {
    const folder = documentFolder(source.document);
    if (folder) roots.push(folder);
  }
  const packRoots = packWebviewRoots(
    packContext.webviewPacks.map((pack) => pack.folder),
    packCacheDir(context),
  );
  for (const root of packRoots) {
    roots.push(vscode.Uri.file(root));
  }
  return roots;
}

/**
 * The extension-owned directory a pack's compiled registration script may
 * be cached under (`./packs/pack-build.ts`'s `cacheDir` parameter) —
 * derived from `ExtensionContext.globalStorageUri`, NEVER a pack's own
 * folder (AGENTS.md's cleanliness rule: the user's file tree stays clean).
 * `globalStorageUri` is per-extension already, so a `pack-cache`
 * subdirectory is enough to keep it out of the way of whatever else the
 * extension stores there.
 */
export function packCacheDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'pack-cache');
}

/**
 * Absolute path to a REAL, unbundled `esbuild-wasm/lib/browser.js` next to
 * the packaged extension (`esbuild.config.mjs` copies it there — see that
 * file's doc comment), or `undefined` if it is not present (dev/Vitest,
 * where `dist/` has never been built this way) — `@markii/host`'s
 * `packs/pack-build.ts`'s `loadEsbuildWasm` then falls back to plain
 * `node_modules` resolution, exactly the same "undefined is always safe to
 * pass" posture `./run/worker-entry.ts`'s `resolveWasmUri` already takes
 * for wasmoon's `glue.wasm`.
 */
export function esbuildBrowserModulePath(
  context: vscode.ExtensionContext,
): string | undefined {
  const candidate = path.join(
    context.extensionUri.fsPath,
    'dist',
    'esbuild-wasm',
    'lib',
    'browser.js',
  );
  return existsSync(candidate) ? candidate : undefined;
}

/**
 * Absolute path to the `esbuild.wasm` binary sitting next to the copied
 * `lib/browser.js` (same `esbuild.config.mjs` copy step) — what
 * `loadEsbuildWasm` compiles via `WebAssembly.compile` before initializing
 * esbuild-wasm's in-process build. `undefined` with the same fallback
 * posture as `esbuildBrowserModulePath`.
 */
export function esbuildWasmBinaryPath(
  context: vscode.ExtensionContext,
): string | undefined {
  const candidate = path.join(
    context.extensionUri.fsPath,
    'dist',
    'esbuild-wasm',
    'esbuild.wasm',
  );
  return existsSync(candidate) ? candidate : undefined;
}

/** The `markii.packs` setting's raw, unresolved entries. */
function configuredPackFolders(): readonly string[] {
  return vscode.workspace.getConfiguration('markii').get<string[]>('packs', []);
}

/** The single-root workspace's filesystem path, or `undefined` with none open — what a relative `markii.packs` entry resolves against (`./packs/resolve-pack-paths.ts`). */
function workspaceRootPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Whether `markii.runOnOpen` (GitHub issue #11) is enabled — an opt-in, read-only run when a note's preview first opens. Off by default. */
function runOnOpenEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('markii')
    .get<boolean>('runOnOpen', false);
}

/**
 * Whether `markii.allowPrivateNetworkAddresses` (GitHub issue #10) is
 * enabled — the deployment opt-in that lets a GRANTED host resolve to a
 * loopback/private/link-local address instead of being refused. Off by
 * default, which is the posture that closes the SSRF/DNS-rebinding case;
 * see the setting's own `markdownDescription` in `package.json`. Read fresh
 * on every run rather than cached, same as every other `markii.*` setting
 * here — there is no panel-lifetime state to keep in sync.
 */
function allowPrivateNetworkAddresses(): boolean {
  return vscode.workspace
    .getConfiguration('markii')
    .get<boolean>('allowPrivateNetworkAddresses', false);
}

/**
 * The scheduled-refresh interval in milliseconds, or `undefined` when
 * refresh is off (`markii.refreshIntervalSeconds` at 0, its default, or any
 * non-positive/invalid value). A positive value below
 * `MIN_REFRESH_INTERVAL_SECONDS` is clamped up to it.
 */
function refreshIntervalMs(): number | undefined {
  const seconds = vscode.workspace
    .getConfiguration('markii')
    .get<number>('refreshIntervalSeconds', 0);
  if (
    typeof seconds !== 'number' ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return undefined;
  }
  return Math.max(seconds, MIN_REFRESH_INTERVAL_SECONDS) * 1000;
}

/**
 * Loads the current `markii.packs` install state (GitHub issue #3 slice 5):
 * resolves the setting's entries against the open workspace root, discovers
 * and validates each folder's `pack.json`, pre-reads every discovered
 * pack's `scripts/*.lua` for the Run path, and — for a pack with no
 * prebuilt `webview.js` — compiles one from its `.tsx` sources
 * (`./packs/pack-build.ts`), cached under `packCacheDir(context)`. Called
 * once per panel (re)creation — see `ActivePreview.packContext`'s doc
 * comment on why a setting change needs a fresh panel to take effect, same
 * as `localResourceRoots` itself.
 */
function loadCurrentPackContext(
  context: vscode.ExtensionContext,
): Promise<PackContext> {
  const cacheDir = packCacheDir(context);
  const browserModulePath = esbuildBrowserModulePath(context);
  const wasmBinaryPath = esbuildWasmBinaryPath(context);
  return loadPackContext(configuredPackFolders(), workspaceRootPath(), {
    cacheDir,
    buildWebviewScript: (pack, dir) =>
      buildPackRegistrationScript(pack, dir, {
        esbuildBrowserModulePath: browserModulePath,
        esbuildWasmBinaryPath: wasmBinaryPath,
      }),
  });
}

/**
 * The one preview panel this extension ever has open — `openPreview`
 * reveals/redirects it rather than opening a second, matching how VS Code's
 * own built-in markdown preview follows a single panel across the active
 * editor. `undefined` whenever no panel is open; set in `createPreview`,
 * cleared in the panel's `onDidDispose` handler.
 */
let active: ActivePreview | undefined;

/**
 * The extension's one diagnostics surface (AGENTS.md's "clean is not
 * silent": every failure needs a full diagnostic somewhere a user can find
 * it, not just a quiet marker in the preview) — set once by
 * `extension.ts`'s `activate` and written to by `logPackDiagnostics` below.
 * `undefined` only in a test/host context that never called
 * `setDiagnosticsChannel`; every write degrades to a no-op rather than
 * throwing.
 */
let diagnosticsChannel: vscode.OutputChannel | undefined;

/** Wires the "Markii" output channel `extension.ts` creates once at activation into this module, so `createPreview` can log pack diagnostics to it. */
export function setDiagnosticsChannel(channel: vscode.OutputChannel): void {
  diagnosticsChannel = channel;
}

/**
 * Writes this pack load's diagnostic lines (`./packs/pack-diagnostics.ts`)
 * to the "Markii" output channel — one line per successfully loaded pack
 * (name, namespace, component count) and one per folder that failed, with
 * the reason `discoverPacks` recorded. Called once per panel (re)creation,
 * right after `loadCurrentPackContext`, so the channel accumulates a
 * history across reloads rather than only ever showing the latest state.
 * A load that found nothing configured at all writes nothing, so an empty
 * channel still means something (this extension has never seen a pack
 * folder) rather than "the last load failed silently".
 */
function logPackDiagnostics(packContext: PackContext): void {
  if (!diagnosticsChannel) return;
  const lines = formatPackDiagnosticLines(packContext);
  if (lines.length === 0) return;
  diagnosticsChannel.appendLine(
    `Markii: pack load at ${new Date().toISOString()}`,
  );
  for (const line of lines) diagnosticsChannel.appendLine(`  ${line}`);
}

/**
 * Writes one `PackDiagnosticsMessage` the webview posted (issue #20, see
 * `webview/pack-registry.ts` and `protocol.ts`) to the "Markii" output
 * channel. Called on receipt, never proactively; a message with all three
 * arrays empty is never sent by the webview in the first place, but this
 * still guards against writing an empty entry either way.
 */
function logPackRegistrationDiagnostics(message: PackDiagnosticsMessage): void {
  if (!diagnosticsChannel) return;
  const lines = formatPackRegistrationDiagnosticLines(message);
  if (lines.length === 0) return;
  diagnosticsChannel.appendLine(
    `Markii: pack registration at ${new Date().toISOString()}`,
  );
  for (const line of lines) diagnosticsChannel.appendLine(`  ${line}`);
}

/**
 * Sends the panel's current source as a fresh message, bumping `revision`
 * first so every message this extension ever sends is monotonically
 * numbered — `isNewerRevision` (`protocol.ts`) on the webview side relies on
 * that to ignore anything older than what it already rendered.
 */
function postUpdate(preview: ActivePreview): void {
  preview.revision += 1;
  preview.panel.title = titleForSource(preview.source);
  const source = preview.source;

  if (source.kind === 'bundle-error') {
    const message: HostToWebviewMessage = {
      type: 'bundle-error',
      revision: preview.revision,
      message: source.message,
    };
    void preview.panel.webview.postMessage(message);
    return;
  }

  if (source.kind === 'bundle-archive') {
    const lastRun = readLastRunTrace(preview.memento, source.bundle.identity);
    const message: HostToWebviewMessage = {
      type: 'update',
      revision: preview.revision,
      text: source.text,
      assets: source.assets,
      readOnly: true,
      packNamespaces: preview.packContext.namespaces,
      packSkippedCount: skippedPackCount(preview.packContext),
      ...(lastRun ? { lastRun } : {}),
    };
    void preview.panel.webview.postMessage(message);
    postStalePersistedValues(preview, source);
    return;
  }

  const baseUri = baseUriForDocument(source.document, preview);
  const lastRun = readLastRunTrace(
    preview.memento,
    source.document.uri.toString(),
  );
  const message: HostToWebviewMessage = {
    type: 'update',
    revision: preview.revision,
    text: source.document.getText(),
    // Spread rather than `baseUri: undefined`: `postMessage`'s structured
    // clone preserves an own property whose value is `undefined`, and the
    // wire format says a document with no folder OMITS the field.
    ...(baseUri === undefined ? {} : { baseUri }),
    packNamespaces: preview.packContext.namespaces,
    packSkippedCount: skippedPackCount(preview.packContext),
    ...(lastRun ? { lastRun } : {}),
  };
  void preview.panel.webview.postMessage(message);
  postStalePersistedValues(preview, source);
}

/**
 * Immediately after an `update`, re-posts this note's persisted last-known
 * values as a `values` message at the SAME revision, marked stale (GitHub
 * issue #11, gap 1). Posting the two back-to-back inside the synchronous
 * `postUpdate` guarantees they carry the same revision, so the webview
 * (which drops a `values` message whose revision no longer matches the text
 * it is showing — see `webview/preview.tsx`) always accepts these: a
 * reopened note shows its last figures instantly, visibly stale, before (or
 * without) any re-run. A note with nothing persisted posts nothing, so the
 * empty-state behavior is unchanged. A fresh run's own `values` message
 * (posted later, at run time) supersedes these, since it carries fresh
 * statuses at the current revision.
 */
function postStalePersistedValues(
  preview: ActivePreview,
  source: Extract<PreviewSource, { kind: 'document' | 'bundle-archive' }>,
): void {
  const documentKey = documentKeyForSource(source);
  if (documentKey === undefined) return;
  const persisted = readPersistedValues(preview.memento, documentKey);
  if (Object.keys(persisted).length === 0) return;
  const stale: Record<string, StoredValue> =
    staleValuesForRehydration(persisted);
  const message: ValuesMessage = {
    type: 'values',
    revision: preview.revision,
    values: stale,
    failures: [],
  };
  void preview.panel.webview.postMessage(message);
}

/**
 * The webview-visible URI of `document`'s folder, with a trailing `/` so
 * relative sources resolve INSIDE it (see `withTrailingSlash`), or
 * `undefined` for a document with no folder. `asWebviewUri` only ever
 * produces a loadable URL for a path inside the panel's
 * `localResourceRoots`; `retargetToDocument` is what keeps that true.
 */
function baseUriForDocument(
  document: vscode.TextDocument,
  preview: ActivePreview,
): string | undefined {
  const folder = documentFolder(document);
  if (!folder) return undefined;
  return withTrailingSlash(
    preview.panel.webview.asWebviewUri(folder).toString(),
  );
}

/**
 * Builds and assigns the webview's HTML, with a FRESH nonce every time — a
 * nonce authorizes exactly one script load and must never be reused across
 * HTML assignments.
 *
 * `packContext.webviewPacks` supplies the pack registration script URIs
 * (GitHub issue #3 slice 5): each is resolved through THIS webview's own
 * `asWebviewUri`, exactly like `scriptUri`/`styleUri` — never a bare
 * filesystem path — so loading one is subject to the SAME
 * `localResourceRoots` jail (`localResourceRootsFor` above, which is what
 * actually grants access to each pack's folder, restricted to only the
 * folders `markii.packs` names) as every other local resource this webview
 * loads. The same is true of `packStyleUris` (the pack-CSS design):
 * `stylesheetPath` sits in the same cache directory as
 * `scriptPath`, already covered by `packWebviewRoots`
 * (`localResourceRootsFor`), and is only ever present when
 * `./packs/pack-build.ts` actually emitted a `.css` sibling.
 */
function setHtml(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  packContext: PackContext,
): void {
  const webview = panel.webview;
  const webviewDistUri = vscode.Uri.joinPath(
    context.extensionUri,
    'dist',
    'webview',
  );
  const scriptUri = webview
    .asWebviewUri(vscode.Uri.joinPath(webviewDistUri, 'main.js'))
    .toString();
  const styleUri = webview
    .asWebviewUri(vscode.Uri.joinPath(webviewDistUri, 'main.css'))
    .toString();
  const packScriptUris = packContext.webviewPacks.map((pack) =>
    webview.asWebviewUri(vscode.Uri.file(pack.scriptPath)).toString(),
  );
  const packStyleUris = packContext.webviewPacks
    .filter((pack) => pack.stylesheetPath !== undefined)
    .map((pack) =>
      webview.asWebviewUri(vscode.Uri.file(pack.stylesheetPath!)).toString(),
    );

  webview.html = buildWebviewHtml({
    scriptUri,
    styleUri,
    cspSource: webview.cspSource,
    nonce: createNonce(),
    title: DOCUMENT_TITLE,
    packScriptUris,
    packStyleUris,
  });
}

/**
 * Switches the tracked document (used both when the command re-targets an
 * already-open panel, and when the active editor changes to a different
 * previewable document): drops any in-flight debounced update for the OLD
 * source — it would otherwise arrive after this synchronous, immediate post
 * and could stomp the new document's content with stale text — then posts
 * the new document's text right away.
 */
/** The current source's bundle context, when `document` is the exact same document that source is already showing — used so a plain document-navigation helper (reveal-again, follow-the-editor) never silently drops a directory-form bundle's run context just by re-deriving a fresh `{kind: 'document', document}` source. */
function preservedBundleContext(
  source: PreviewSource,
  document: vscode.TextDocument,
): Extract<PreviewSource, { kind: 'document' }>['bundle'] | undefined {
  return source.kind === 'document' &&
    source.document.uri.toString() === document.uri.toString()
    ? source.bundle
    : undefined;
}

function switchDocument(
  preview: ActivePreview,
  document: vscode.TextDocument,
): void {
  const bundle = preservedBundleContext(preview.source, document);
  preview.source = {
    kind: 'document',
    document,
    ...(bundle ? { bundle } : {}),
  };
  preview.debouncer.cancel();
  postUpdate(preview);
}

/**
 * Points the existing preview at `document` — the one entry point for
 * changing which plain document the panel shows, used by the command
 * (re-targeting an open panel), by the follow-the-active-editor listener,
 * and by `openDirectoryBundle` once it has resolved a bundle's contained
 * `note.mk.md`.
 *
 * Almost always this is a plain `switchDocument`. The exception is a
 * document whose folder no `localResourceRoots` entry covers: that set is
 * immutable after creation (see `localResourceRootsFor`), so the ONLY way to
 * let that document's images load is a fresh panel. It is recreated in the
 * same view column so the recreation reads as a refresh rather than the
 * preview jumping somewhere else.
 */
async function retargetToDocument(
  context: vscode.ExtensionContext,
  preview: ActivePreview,
  document: vscode.TextDocument,
): Promise<void> {
  const folder = documentFolder(document);
  if (!folder || isCoveredByRoots(preview.rootKeys, rootKey(folder))) {
    switchDocument(preview, document);
    return;
  }

  const bundle = preservedBundleContext(preview.source, document);
  const viewColumn = preview.panel.viewColumn;
  // Disposing runs the panel's own `onDidDispose` synchronously, which
  // clears `active` and unhooks every listener — including, possibly, the
  // one this call is running inside. That is safe (disposing an event
  // subscription during its own callback is supported), and `createPreview`
  // below immediately installs a fresh `active`.
  preview.panel.dispose();
  await createPreview(
    context,
    { kind: 'document', document, ...(bundle ? { bundle } : {}) },
    viewColumn,
  );
}

function activePreviewableDocument(): vscode.TextDocument | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor && isPreviewableDocument(editor.document)
    ? editor.document
    : undefined;
}

/**
 * Shows `source` in the singleton preview panel: for a plain document this
 * re-targets (or creates) the panel exactly as `markii.openPreview` always
 * has; for a bundle-derived source (`bundle-archive`/`bundle-error`) it
 * always creates a fresh panel — those sources have no existing
 * `TextDocument`/folder to compare `rootKeys` against, so there is nothing
 * to gain from trying to reuse the current panel's roots.
 */
async function presentSource(
  context: vscode.ExtensionContext,
  source: PreviewSource,
): Promise<void> {
  if (source.kind === 'document') {
    if (active) {
      await retargetToDocument(context, active, source.document);
      const current = active;
      if (current) current.panel.reveal(current.panel.viewColumn, true);
      return;
    }
    await createPreview(context, source);
    return;
  }

  const viewColumn = active?.panel.viewColumn;
  active?.panel.dispose();
  await createPreview(context, source, viewColumn);
  const current = active;
  if (current) current.panel.reveal(current.panel.viewColumn, true);
}

/**
 * Wires up the singleton panel's full lifecycle: the ready/update
 * handshake, following text edits (debounced, `document` sources only) and
 * the active editor (immediately), and rehydration when the panel becomes
 * visible again.
 *
 * DECISION — `retainContextWhenHidden: false` plus state rehydration,
 * NOT context retention: retaining context would pin a full React + Markii
 * renderer webview in memory for the entire life of the window, but this
 * extension's ENTIRE state is one string and one revision number. Instead,
 * the webview persists `{text, revision, ...}` via `setState` on every
 * applied update and restores it from `getState()` immediately on (re)load
 * (`webview/preview.tsx`), and this function re-posts the current source
 * below whenever the panel becomes visible again (`onDidChangeViewState`)
 * — so from the user's perspective a tab switch is indistinguishable from
 * true context retention, at no standing memory cost while the panel is
 * hidden.
 */
async function createPreview(
  context: vscode.ExtensionContext,
  source: PreviewSource,
  viewColumn?: vscode.ViewColumn,
): Promise<void> {
  // GitHub issue #3 slice 5: loaded fresh on every panel (re)creation, and
  // BEFORE `localResourceRoots`/the HTML are built, since both depend on
  // which packs are actually installed right now — see
  // `ActivePreview.packContext`'s doc comment on why a `markii.packs`
  // change only takes effect on the next (re)creation.
  const packContext = await loadCurrentPackContext(context);
  logPackDiagnostics(packContext);

  const roots = localResourceRootsFor(context, source, packContext);
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    titleForSource(source),
    {
      viewColumn: viewColumn ?? vscode.ViewColumn.Beside,
      preserveFocus: true,
    },
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: roots,
    },
  );

  setHtml(panel, context, packContext);

  const preview: ActivePreview = {
    panel,
    source,
    revision: 0,
    rootKeys: roots.map(rootKey),
    packContext,
    memento: context.workspaceState,
    debouncer: createDebouncer<void>(DEBOUNCE_MS, () => {
      postUpdate(preview);
    }),
    running: false,
    ranOnOpen: false,
  };
  active = preview;
  void vscode.commands.executeCommand(
    'setContext',
    PREVIEW_ACTIVE_CONTEXT_KEY,
    true,
  );

  const disposables: vscode.Disposable[] = [
    // The ready/update handshake: the webview posts `{type: 'ready'}` once
    // its message listener has attached, and ONLY THEN do we post the first
    // `update` — a `postMessage` sent before that listener attaches would
    // otherwise be silently dropped.
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (!isWebviewToHostMessage(raw)) return;
      if (raw.type === 'ready') {
        postUpdate(preview);
        maybeRunOnOpen(context, preview);
      } else if (raw.type === 'pack-diagnostics') {
        logPackRegistrationDiagnostics(raw);
      }
    }),

    // Text edits are debounced (matching the playground's own
    // DEBOUNCE_MS) so a fast typist doesn't flood the webview with one
    // `update` per keystroke. Only ever relevant for a `document` source —
    // a `bundle-archive`/`bundle-error` source has no editor buffer to
    // watch.
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (preview.source.kind !== 'document') return;
      if (event.document !== preview.source.document) return;
      preview.debouncer.schedule();
    }),

    // Following the active editor is immediate, not debounced — switching
    // files should feel instant. A non-previewable editor gaining focus
    // (an Output pane, this very preview panel, a settings UI, ...) is
    // explicitly NOT switched to — the preview keeps showing whatever it
    // was already showing rather than ever going blank. This also covers
    // switching AWAY from a bundle-derived source: focusing any ordinary
    // previewable document resumes the familiar follow-the-editor behavior.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || !isPreviewableDocument(editor.document)) return;
      void retargetToDocument(context, preview, editor.document);
    }),

    // Rehydration: `retainContextWhenHidden: false` means the webview is
    // torn down while hidden and rebuilt from scratch when shown again —
    // its own `getState()`-based restore (`webview/preview.tsx`) covers the
    // instant before this arrives, and this re-post brings it fully current
    // in case anything changed while it was gone.
    panel.onDidChangeViewState(() => {
      if (panel.visible) {
        postUpdate(preview);
      }
    }),
  ];

  // GitHub issue #11 (scheduled refresh): if the setting asks for it, drive
  // periodic `'scheduled'`-trigger re-runs. Read once here, like every other
  // per-panel setting; the timer is cleared on dispose below so a torn-down
  // panel never keeps firing, and each tick is a no-op while a run is already
  // in flight (`runWithTrigger`'s own `running` guard).
  const intervalMs = refreshIntervalMs();
  if (intervalMs !== undefined) {
    preview.refreshTimer = setInterval(() => {
      if (active !== preview) return;
      void runWithTrigger(context, 'scheduled');
    }, intervalMs);
    // Never let the refresh timer keep the extension host's event loop alive
    // on its own.
    preview.refreshTimer.unref?.();
  }

  panel.onDidDispose(() => {
    preview.debouncer.cancel();
    if (preview.refreshTimer !== undefined) {
      clearInterval(preview.refreshTimer);
      preview.refreshTimer = undefined;
    }
    for (const disposable of disposables) {
      disposable.dispose();
    }
    active = undefined;
    void vscode.commands.executeCommand(
      'setContext',
      PREVIEW_ACTIVE_CONTEXT_KEY,
      false,
    );
  });
}

/**
 * Performs the at-most-once run-on-open (GitHub issue #11) for `preview`,
 * if `markii.runOnOpen` is enabled. Guarded by `preview.ranOnOpen` so it
 * fires a single time per panel life, not on every hide/show rehydration
 * (the webview re-sends `ready` each time it is rebuilt). The run goes
 * through the `'auto'` trigger: read-only tier, grants resolved
 * non-interactively (never a prompt on open), last-known values already
 * shown stale by `postStalePersistedValues` until it completes.
 */
function maybeRunOnOpen(
  context: vscode.ExtensionContext,
  preview: ActivePreview,
): void {
  if (preview.ranOnOpen) return;
  if (preview.source.kind === 'bundle-error') return;
  if (!runOnOpenEnabled()) return;
  preview.ranOnOpen = true;
  void runWithTrigger(context, 'auto');
}

/** Logs a bundle-resolution failure's detail (never shown on screen — see `bundleResolutionFailureMessage`) for anyone using "Open Webview Developer Tools" or the extension host's own console. */
function logBundleResolutionFailure(
  bundleName: string,
  resolution: Extract<BundleResolution, { ok: false }>,
): void {
  console.error(
    `Markii: bundle "${bundleName}" failed to resolve (${resolution.reason})${
      resolution.detail ? `: ${resolution.detail}` : ''
    }`,
  );
}

/**
 * Opens the directory form of a `.mkz`/`.mkbundle` bundle: reads and
 * validates its manifest via `@markii/bundle`'s Node `fs` storage
 * (`openDirBundle`), resolves the document it names (or the conventional
 * `note.mk.md`), and — because that document is a REAL file on disk —
 * shows it through the exact same `document` preview path a plain `.mk.md`
 * file takes. Nothing about live-edit tracking, debouncing, or relative
 * image resolution needs bundle-specific code: `note.mk.md`'s own folder
 * (the bundle root) already becomes this preview's `localResourceRoots`
 * entry, so `assets/nice.png` just resolves.
 */
async function openDirectoryBundle(
  bundleUri: vscode.Uri,
  bundleName: string,
  context: vscode.ExtensionContext,
): Promise<void> {
  const storage: BundleStorage = openDirBundle(bundleUri.fsPath);
  const resolution = await resolveBundleDocument(storage);
  if (!resolution.ok) {
    logBundleResolutionFailure(bundleName, resolution);
    await presentSource(context, {
      kind: 'bundle-error',
      title: bundlePreviewTitleFor(bundleName, false),
      message: bundleResolutionFailureMessage(resolution.reason),
    });
    return;
  }

  const documentUri = vscode.Uri.joinPath(bundleUri, resolution.documentPath);
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(documentUri);
  } catch {
    await presentSource(context, {
      kind: 'bundle-error',
      title: bundlePreviewTitleFor(bundleName, false),
      message: "This bundle's document could not be found.",
    });
    return;
  }

  await vscode.window.showTextDocument(document, { preview: false });
  await presentSource(context, {
    kind: 'document',
    document,
    bundle: {
      form: 'directory',
      manifest: resolution.manifest,
      rootDir: bundleUri.fsPath,
    },
  });
}

/**
 * Opens the zip form of a `.mkz`/`.mkbundle` bundle: reads the archive's
 * bytes and hands them to `@markii/bundle`'s `openZipBundle` (which itself
 * rejects zip-slip/collision/decompression-bomb/CRC-corrupt archives —
 * `openZipBundle` throws, never silently drops entries), validates the
 * manifest, resolves the document, and shows it READ-ONLY: there is no
 * editable buffer behind an archived file, so the preview is a one-shot
 * static render rather than a `document` source, and the panel's title
 * carries the "(read-only)" marker (`bundlePreviewTitleFor`).
 *
 * A webview cannot reach into a zip archive to load an image the way it
 * loads a real file under `localResourceRoots`, so recognized image types
 * under `assets/` are extracted ahead of time as `data:` URIs
 * (`extractAssetsAsDataUris`) and sent inline with the document text.
 */
async function openZipBundleArchive(
  bundleUri: vscode.Uri,
  bundleName: string,
  context: vscode.ExtensionContext,
): Promise<void> {
  // P2-b: bound the archive read by its on-disk size BEFORE materializing it
  // (see `zipArchiveTooLarge`). A single huge `.mkz` must not be read whole
  // into the host just to be opened — every per-entry cap downstream operates
  // on a `BundleStorage` that only exists once the archive is already in
  // memory, so the guard has to sit here, ahead of `readFile`.
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(bundleUri);
  } catch {
    await presentSource(context, {
      kind: 'bundle-error',
      title: bundlePreviewTitleFor(bundleName, true),
      message: 'This bundle could not be read.',
    });
    return;
  }
  if (zipArchiveTooLarge(stat.size)) {
    console.error(
      `Markii: zip bundle "${bundleName}" is ${stat.size} bytes, exceeding the archive open cap`,
    );
    await presentSource(context, {
      kind: 'bundle-error',
      title: bundlePreviewTitleFor(bundleName, true),
      message: 'This bundle is too large to open.',
    });
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(bundleUri);
  } catch {
    await presentSource(context, {
      kind: 'bundle-error',
      title: bundlePreviewTitleFor(bundleName, true),
      message: 'This bundle could not be read.',
    });
    return;
  }

  let storage: BundleStorage;
  try {
    storage = openZipBundle(bytes);
  } catch (err) {
    console.error(
      `Markii: zip bundle "${bundleName}" rejected:`,
      err instanceof Error ? err.message : String(err),
    );
    await presentSource(context, {
      kind: 'bundle-error',
      title: bundlePreviewTitleFor(bundleName, true),
      message:
        'This bundle could not be opened (invalid or unsafe zip archive).',
    });
    return;
  }

  const resolution = await resolveBundleDocument(storage);
  if (!resolution.ok) {
    logBundleResolutionFailure(bundleName, resolution);
    await presentSource(context, {
      kind: 'bundle-error',
      title: bundlePreviewTitleFor(bundleName, true),
      message: bundleResolutionFailureMessage(resolution.reason),
    });
    return;
  }

  const assets = await extractAssetsAsDataUris(storage);
  await presentSource(context, {
    kind: 'bundle-archive',
    text: resolution.text,
    assets,
    title: bundlePreviewTitleFor(bundleName, true),
    bundle: {
      form: 'zip',
      manifest: resolution.manifest,
      storage,
      identity: bundleUri.toString(),
    },
  });
}

/**
 * Entry point for opening a preview from an explicit `uri` — the explorer
 * context menu path (`package.json`'s `explorer/context` entry) for a
 * `.mkz`/`.mkbundle` directory or zip file. Classifies the target
 * (`classifyBundleTarget`) and dispatches to the matching flow; a
 * bundle-shaped NAME that isn't actually a directory or zip (unlikely, but
 * `stat` is the ground truth) falls back to trying it as a plain document,
 * same as any other `uri`.
 */
async function openPreviewForUri(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
): Promise<void> {
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    void vscode.window.showErrorMessage(
      'Markii: could not open this item for preview.',
    );
    return;
  }

  const name = baseName(uri);
  const isDirectory = (stat.type & vscode.FileType.Directory) !== 0;
  const kind = classifyBundleTarget(name, isDirectory);

  if (kind === 'directory') {
    await openDirectoryBundle(uri, name, context);
    return;
  }
  if (kind === 'zip') {
    await openZipBundleArchive(uri, name, context);
    return;
  }
  if (isDirectory) {
    void vscode.window.showInformationMessage(
      'Markii: this folder is not a .mkz bundle.',
    );
    return;
  }

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false });
    await presentSource(context, { kind: 'document', document });
  } catch {
    void vscode.window.showErrorMessage(
      'Markii: could not open this item for preview.',
    );
  }
}

/** Prompts once for a specific host, with the normative modal wording (`run/grant-flow.ts`'s `hostPromptMessage`) and the Allow / Don't allow button pair. */
async function promptHostAdapter(host: string): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    hostPromptMessage(host),
    { modal: true },
    ALLOW_LABEL,
    DONT_ALLOW_LABEL,
  );
  return choice === ALLOW_LABEL;
}

/** Prompts once for the "this note builds a network address dynamically" consent gate (`run/grant-flow.ts`'s `UNKNOWN_HOSTS_PROMPT_MESSAGE`). */
async function promptUnknownHostsAdapter(): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    UNKNOWN_HOSTS_PROMPT_MESSAGE,
    { modal: true },
    ALLOW_LABEL,
    DONT_ALLOW_LABEL,
  );
  return choice === ALLOW_LABEL;
}

/**
 * Prompts once for the PROMPT-STORM guard's consolidated "many hosts" gate
 * (`run/grant-flow.ts`'s `MAX_HOST_PROMPTS`/`manyHostsPromptMessage`) instead
 * of opening one modal per host once a note's distinct static host count
 * exceeds the cap.
 */
async function promptManyHostsAdapter(hostCount: number): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    manyHostsPromptMessage(hostCount),
    { modal: true },
    ALLOW_LABEL,
    DONT_ALLOW_LABEL,
  );
  return choice === ALLOW_LABEL;
}

/** Prompts once, all-or-nothing, for a bundle's declared bundle-fs grants (`run/grant-flow.ts`'s `bundleAccessPromptMessage`). */
async function promptBundleAccessAdapter(
  grants: readonly BundleFsGrant[],
): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    bundleAccessPromptMessage(grants),
    { modal: true },
    ALLOW_LABEL,
    DONT_ALLOW_LABEL,
  );
  return choice === ALLOW_LABEL;
}

/**
 * The `markii.runScripts` command handler: runs the currently previewed
 * document's scripts once (grant flow, then `spawnRun`) and posts the
 * outcome to the panel as a `values` message.
 *
 * A press that arrives while no preview is open, while a previous press is
 * still running, or while the preview is showing a `bundle-error` source
 * (nothing resolved well enough to run) is a no-op. See
 * `ActivePreview.running`'s doc comment for why a running press is
 * "ignore", not "cancel and restart".
 *
 * Slice 2 of the `.mkz` Run-path arc (GitHub issue #9): a bundle-backed
 * `document` source (a directory-form bundle's contained `note.mk.md`) and
 * a `bundle-archive` source (a read-only zip form, run entirely in memory)
 * both run their scripts with the bundle-fs capability wired in —
 * `bundleOptionsFor` below builds each form's `buildSnapshot`/
 * `persistCacheOut` pair; a plain, bundle-free `document` source runs
 * exactly as slice 1 left it, with no `bundle` option at all.
 *
 * The result is tagged with the revision captured BEFORE `runOnce`'s own
 * awaits (the grant prompts and the run itself can each take a while, and
 * the document may keep changing underneath) — the webview
 * (`webview/preview.tsx`) drops a `values` message whose revision no
 * longer matches what it is currently displaying.
 *
 * C-5: this function is called as a floating promise (`void runScripts(...)`
 * in `extension.ts`), so it must NEVER reject — every awaited step here
 * (a grant prompt, `Memento.update` inside `runOnce`, `spawnRun`, and the
 * final `postMessage`) is a `vscode`/host-provided call that can in
 * principle reject, and an uncaught rejection on a floating promise
 * surfaces to the user as nothing at all (an "unhandled rejection" only
 * VS Code's own logs would ever show). The whole body is therefore wrapped
 * in a `try/catch` that shows one short, stack-free error message instead,
 * and `preview.running` is always cleared in `finally` regardless of which
 * path was taken.
 */
/** The `vscode.Memento` key a zip-form bundle's persisted `.cache/` state lives under, keyed by the archive's own identity (its URI string) — never the user's zip file itself, see this file's design comment on `BundleRunContext`. */
function bundleCacheStorageKeyFor(identity: string): string {
  return `markii.bundleCache:${identity}`;
}

/**
 * Builds `runOnce`'s optional `bundle` option for a bundle-backed source —
 * `undefined` for a plain, bundle-free `document`. Directory form reads and
 * persists straight through `@markii/bundle`'s `openDirBundle` (itself
 * symlink/hard-link-safe, see `packages/markii-bundle/src/fs.ts`), so
 * `.cache/` writes land back in the bundle directory on disk exactly like
 * any other bundle write. Zip form never touches the user's archive: its
 * snapshot is built from the ALREADY-OPEN in-memory `storage` this preview
 * was created from, overlaid with whatever `.cache/` state a PRIOR run
 * persisted to extension storage (`decodeBundleCacheFromStorage`), and a
 * run's own `.cache/` output is written back to that same extension
 * storage, keyed by the archive's identity.
 */
function bundleOptionsFor(
  context: vscode.ExtensionContext,
  bundle: BundleRunContext,
): Parameters<typeof runOnce>[0]['bundle'] {
  if (bundle.form === 'directory') {
    const rootDir = bundle.rootDir;
    return {
      manifest: bundle.manifest,
      buildSnapshot: async () => {
        const { files } = await buildBundleSnapshot(openDirBundle(rootDir));
        return files;
      },
      persistCacheOut: async (cacheOut) => {
        const storage = openDirBundle(rootDir);
        for (const [path, bytes] of Object.entries(cacheOut)) {
          await storage.write(path, bytes);
        }
      },
    };
  }

  const { storage, identity } = bundle;
  const cacheKey = bundleCacheStorageKeyFor(identity);
  return {
    manifest: bundle.manifest,
    buildSnapshot: async () => {
      const { files } = await buildBundleSnapshot(storage);
      const persisted = decodeBundleCacheFromStorage(
        context.workspaceState.get(cacheKey),
      );
      return withPersistedCache(files, persisted);
    },
    persistCacheOut: async (cacheOut) => {
      const encoded = encodeBundleCacheForStorage(cacheOut);
      await context.workspaceState.update(cacheKey, encoded);
    },
  };
}

export async function runScripts(
  context: vscode.ExtensionContext,
): Promise<void> {
  await runWithTrigger(context, 'manual');
}

/**
 * The shared body behind the manual `markii.runScripts` press and the
 * `'auto'`/`'scheduled'` runs GitHub issue #11 adds. `trigger` flows through
 * `runOnce` to the worker, where `@markii/runtime`'s `tierForTrigger` caps
 * what the run may do; for a non-manual trigger `runOnce` also resolves
 * grants non-interactively, so the prompt adapters passed here are simply
 * never invoked (no modal ever opens on a timer or on open). Every other
 * concern — the `running` guard, the revision tag captured before the run's
 * awaits, the disposed-panel check, and the C-5 never-reject wrapping — is
 * identical across triggers, which is why they share one body.
 */
async function runWithTrigger(
  context: vscode.ExtensionContext,
  trigger: RunTrigger,
): Promise<void> {
  const preview = active;
  if (!preview || preview.running) return;
  const source = preview.source;
  if (source.kind === 'bundle-error') return;

  preview.running = true;
  const revision = preview.revision;
  const text =
    source.kind === 'document' ? source.document.getText() : source.text;
  const documentKey =
    source.kind === 'document'
      ? source.document.uri.toString()
      : source.bundle.identity;
  const bundleOptions = source.bundle
    ? bundleOptionsFor(context, source.bundle)
    : undefined;

  try {
    const result = await runOnce({
      documentKey,
      text,
      trigger,
      netPolicy: {
        allowRestrictedAddresses: allowPrivateNetworkAddresses(),
      },
      memento: context.workspaceState,
      promptHost: promptHostAdapter,
      promptUnknownHosts: promptUnknownHostsAdapter,
      promptManyHosts: promptManyHostsAdapter,
      promptBundleAccess: promptBundleAccessAdapter,
      spawnRun,
      timeoutMs: RUN_TIMEOUT_MS,
      // Omitted entirely (not an empty object) when no packs are
      // installed: `@markii/lua`'s `require` classifies a pack-namespaced
      // `require` differently depending on whether a resolver exists at
      // all (a clean 'capability-denied', "packs are not supported in this
      // run") versus a resolver that just doesn't have that module (an
      // ordinary 'script-error', "no such module") — passing `{}` here
      // would silently switch every note to the second, wrong,
      // classification whenever zero packs are configured.
      ...(preview.packContext.packs.length > 0
        ? { packModules: preview.packContext.packModules }
        : {}),
      ...(bundleOptions ? { bundle: bundleOptions } : {}),
    });

    // The panel may have been disposed (or replaced by a fresh one — see
    // `retargetToDocument`) while the run above was in flight; `active` no
    // longer being this exact `preview` means there is nothing left to post
    // to, and touching `preview.panel` past disposal would itself throw.
    if (active !== preview) return;

    // ITEM 3 (AGENTS.md "clean is not silent"): this run's own outcome,
    // attached to its `values` message so the marker updates immediately —
    // see `./run/run-trace.ts`'s doc comment and `ValuesMessage.lastRun`'s.
    const lastRun = { trigger, ranAt: Date.now(), ok: true as const };
    const message: ValuesMessage = {
      type: 'values',
      revision,
      values: result.values,
      failures: result.failures,
      lastRun,
    };
    // Awaited (not fire-and-forget) so a rejection here — e.g. a disposal
    // racing this exact call — lands in the catch below instead of becoming
    // its own unhandled rejection.
    await preview.panel.webview.postMessage(message);

    // Persisted separately so a reopened panel (or the next `postUpdate`)
    // can read it back without a fresh run — best-effort: a write failure
    // here must never turn a successful run into a reported failure, so it
    // is swallowed rather than routed through the catch below.
    void writeLastRunTrace(context.workspaceState, documentKey, lastRun).then(
      undefined,
      () => {},
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('markii.runScripts failed:', detail);
    // Quiet, stack-free message — AGENTS.md's cleanliness principle: the
    // rendered page (and its surrounding UI) shows quiet markers, never
    // error dumps or machinery. The SAME short detail is what the run
    // marker's tooltip carries (`webview/run-marker.ts`'s `runMarkerTitle`)
    // — never a raw stack, but never nothing either.
    void vscode.window.showErrorMessage(
      "Markii: running this note's scripts failed.",
    );
    void writeLastRunTrace(context.workspaceState, documentKey, {
      trigger,
      ranAt: Date.now(),
      ok: false,
      reason: detail,
    }).then(undefined, () => {});
  } finally {
    preview.running = false;
  }
}

/**
 * GitHub issue #28 slice 2: the external wall-clock budget for one
 * `export-request`/`export-result` round trip. `retainContextWhenHidden`
 * is `false`, so a hidden panel's webview has been torn down and cannot
 * answer at all until it is shown again — that is an entirely legitimate
 * state, not a bug, and this deadline is what keeps `exportHtml` from
 * hanging on it: past this, the export falls back to the static engine
 * rather than waiting indefinitely for a reply that may never come.
 */
const EXPORT_RENDER_TIMEOUT_MS = 4000;

/**
 * Asks `preview`'s webview to render one note's body through its own React
 * registry (GitHub issue #28 slice 2) and resolves with the result, or with
 * a `timeout`/`render-failed` `ExportBodyResult` if the webview never
 * answers or answers with a failure. Settles EXACTLY ONCE: whichever of the
 * reply listener or the deadline timer fires first wins, and the other is
 * always disposed/cleared on every path so neither leaks past this call.
 *
 * Matches replies by `requestId` rather than assuming the next
 * `export-result` belongs to this request, since `onDidReceiveMessage`
 * delivers every message the webview posts, not just this one.
 */
function requestExportBody(
  preview: ActivePreview,
  text: string,
  values: Record<string, StoredValue>,
): Promise<ExportBodyResult> {
  const requestId = createNonce();
  return new Promise<ExportBodyResult>((resolve) => {
    let settled = false;
    // A single mutable holder rather than two loose `let`s: `settle` (below)
    // needs to read whichever of these has been set BY THE TIME IT RUNS, and
    // each is itself only ever assigned once at the point of its own
    // creation — a plain `let` assigned exactly once is a `prefer-const`
    // lint error, and there is no way to give either an initializer at
    // declaration time since `settle` must exist first for their own
    // callbacks to reference.
    const handles: {
      listener?: vscode.Disposable;
      timer?: ReturnType<typeof setTimeout>;
    } = {};

    const settle = (result: ExportBodyResult): void => {
      if (settled) return;
      settled = true;
      handles.listener?.dispose();
      if (handles.timer !== undefined) clearTimeout(handles.timer);
      resolve(result);
    };

    handles.listener = preview.panel.webview.onDidReceiveMessage(
      (raw: unknown) => {
        if (!isWebviewToHostMessage(raw) || raw.type !== 'export-result') {
          return;
        }
        if (raw.requestId !== requestId) return;
        if (raw.ok) {
          settle({ ok: true, html: raw.html ?? '' });
        } else {
          settle({
            ok: false,
            reason: 'render-failed',
            detail: raw.reason ?? 'the preview reported a failure.',
          });
        }
      },
    );

    handles.timer = setTimeout(() => {
      settle({
        ok: false,
        reason: 'timeout',
        detail: `the preview did not answer within ${String(EXPORT_RENDER_TIMEOUT_MS)}ms.`,
      });
    }, EXPORT_RENDER_TIMEOUT_MS);
    // Never let this deadline keep the extension host's event loop alive on
    // its own, matching `refreshTimer`'s own `unref` above.
    handles.timer.unref?.();

    const message: ExportRequestMessage = {
      type: 'export-request',
      requestId,
      text,
      values,
    };
    void preview.panel.webview.postMessage(message);
  });
}

/**
 * Writes one export outcome to the "Markii" output channel — the other of a
 * failure's two homes (AGENTS.md's "clean is not silent"). The popup carries
 * the short sentence; the verbatim reason only ever lands here.
 */
function logExportDiagnostics(outcome: HtmlExportOutcome): void {
  if (!diagnosticsChannel) return;
  diagnosticsChannel.appendLine(
    `Markii: HTML export at ${new Date().toISOString()}`,
  );
  for (const line of exportHtmlDiagnosticLines(outcome)) {
    diagnosticsChannel.appendLine(`  ${line}`);
  }
}

/**
 * Whether the currently open preview panel (if any) has at least one pack
 * whose components can actually render in the webview — the same
 * `webviewPacks` list `setHtml` reads to build the `<script>`/`<link>`
 * tags, and therefore the exact set `requestExportBody` can render.
 */
function panelHasWebviewPacks(preview: ActivePreview): boolean {
  return preview.packContext.webviewPacks.length > 0;
}

/**
 * The `markii.exportHtml` command handler ("Markii: Export as HTML", GitHub
 * issue #28): writes the active note as ONE self-contained `.html` file, at
 * a path the user picks, defaulting to the note's own name beside it.
 *
 * ENGINE. Built through `@markii/host`'s `buildNoteExport`, which chooses
 * between two engines:
 *
 * - React, through the OPEN preview panel's own webview, when a panel is
 *   open and it has at least one pack loaded with webview components
 *   (`panelHasWebviewPacks`) — `requestExportBody` asks that webview to
 *   render the note exactly as its live preview would, so pack components
 *   export as themselves rather than as unknown-component boxes, and the
 *   pack's own stylesheet (read from the same `webviewPacks` entries the
 *   preview links, via `./packs/pack-export-styles.ts`) is embedded too.
 * - `@markii/html`, the static string engine, otherwise: no panel is open,
 *   or the open panel has no pack components to render. A pack directive
 *   then comes out as that engine's ordinary unknown-component fallback, a
 *   labeled box with the author's inner markdown still rendered inside it.
 *   This is documented behavior, not a failure, so it is not reported as
 *   one — see `export-html.ts`'s `exportHtmlDiagnosticLines` for exactly
 *   how each case is worded on the diagnostics surface. The user-facing
 *   popup never distinguishes the two engines; only the "Markii" output
 *   channel does.
 *
 * No hidden hosting panel is ever created to render an export: VS Code
 * cannot create a genuinely invisible webview, and spinning up a visible
 * throwaway panel with the whole pack script-tag bootstrap just to answer
 * one export would be worse than a clearly diagnosed static fallback.
 *
 * VALUES. The note's last run is baked in: `readPersistedValues` reads the
 * same `workspaceState` entry the preview rehydrates from, keyed by the
 * document URI, so an export made after a run carries the figures that run
 * produced. Deliberately NOT marked stale the way a rehydrated preview is
 * (`postStalePersistedValues`): a static file has no "re-run" to be stale
 * against, and a page full of stale markers would misreport a snapshot as a
 * live view that has fallen behind. A note that has never been run exports
 * with the standard empty states, and the confirmation message says so.
 *
 * IMAGES. The exported HTML keeps the note's own relative image sources, so
 * a file written beside the note resolves them exactly as the note does.
 * Saving it somewhere else breaks those links; remote images are unaffected.
 */
export async function exportHtml(
  context: vscode.ExtensionContext,
): Promise<void> {
  const document =
    activePreviewableDocument() ??
    (active?.source.kind === 'document' ? active.source.document : undefined);
  if (!document) {
    void vscode.window.showInformationMessage(EXPORT_HTML_NO_DOCUMENT_MESSAGE);
    return;
  }

  const defaultName = exportHtmlDefaultFileName(document.uri.path);
  const defaultUri =
    document.uri.scheme === 'untitled'
      ? undefined
      : vscode.Uri.joinPath(document.uri, '..', defaultName);
  const target = await vscode.window.showSaveDialog({
    title: EXPORT_HTML_SAVE_DIALOG_TITLE,
    saveLabel: EXPORT_HTML_SAVE_LABEL,
    filters: EXPORT_HTML_FILTERS as Record<string, string[]>,
    ...(defaultUri ? { defaultUri } : {}),
  });
  if (!target) return; // cancelled

  const values = readPersistedValues(
    context.workspaceState,
    document.uri.toString(),
  );
  let outcome: HtmlExportOutcome;
  try {
    const preview = active;
    const useReact = preview !== undefined && panelHasWebviewPacks(preview);

    let exportRequest: Parameters<typeof buildNoteExport>[0];
    if (useReact && preview) {
      const packStylesheets = await packExportStylesheets(
        preview.packContext.webviewPacks,
        (path) => readFile(path, 'utf8'),
      );
      exportRequest = {
        text: document.getText(),
        fileName: defaultName,
        values,
        renderBody: (text, vals) => requestExportBody(preview, text, vals),
        packStylesheets,
        packCount: preview.packContext.webviewPacks.length,
      };
    } else {
      // No panel open at all -> 'no-renderer' when at least one pack folder
      // is configured (there WOULD be pack components to render if a panel
      // were open), 'no-packs' otherwise. A panel open with zero webview
      // packs is 'no-packs' regardless of configuration, since nothing about
      // opening a panel would change what this export renders.
      const staticReason =
        preview === undefined && configuredPackFolders().length > 0
          ? 'no-renderer'
          : 'no-packs';
      exportRequest = {
        text: document.getText(),
        fileName: defaultName,
        values,
        staticReason,
      };
    }

    const exportDocument = await buildNoteExport(exportRequest);

    const bytes = new TextEncoder().encode(exportDocument.html);
    await vscode.workspace.fs.writeFile(target, bytes);
    outcome = {
      kind: 'written',
      path: target.fsPath,
      bytes: bytes.byteLength,
      valueCount: exportDocument.valueCount,
      render: exportDocument.render,
    };
  } catch (error) {
    outcome = {
      kind: 'failed',
      path: target.fsPath,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  logExportDiagnostics(outcome);
  const message = exportHtmlResultMessage(outcome);
  if (outcome.kind === 'failed') {
    void vscode.window.showWarningMessage(message);
    return;
  }
  void vscode.window
    .showInformationMessage(message, EXPORT_HTML_REVEAL_LABEL)
    .then((choice) => {
      if (choice === EXPORT_HTML_REVEAL_LABEL) {
        void vscode.commands.executeCommand('revealFileInOS', target);
      }
    });
}

/**
 * The `markii.resetScriptGrants` command handler (C-3): clears the
 * persisted network grant for the active Markii document, so the next
 * `markii.runScripts` press prompts fresh for every host again — the escape
 * hatch for a partial grant the user wants to revisit without editing the
 * note's code (which would change the grant key and force a re-prompt
 * anyway, but is not always what someone wants to do just to see the
 * prompt again).
 */
export async function resetScriptGrants(
  context: vscode.ExtensionContext,
): Promise<void> {
  const document =
    activePreviewableDocument() ??
    (active?.source.kind === 'document' ? active.source.document : undefined);
  if (!document) {
    void vscode.window.showInformationMessage(
      'Open a .mk.md document to reset its script permissions.',
    );
    return;
  }

  await clearGrantForDocument(context.workspaceState, document.uri.toString());
  void vscode.window.showInformationMessage(
    "Markii: cleared this note's saved script permissions. The next run will prompt again.",
  );
}

/**
 * The `markii.openPreview` command handler. With an explicit `uri` (the
 * explorer context menu path — a `.mkz`/`.mkbundle` directory or zip file,
 * or any other resource), delegates entirely to `openPreviewForUri`.
 * Without one (the command palette / title-bar-button / keybinding paths),
 * opens a new panel for the active previewable document, or — if a panel
 * is already open — re-targets and reveals it. If nothing previewable is
 * active and no panel exists yet, informs the user instead of opening an
 * empty/blank preview.
 */
export async function openPreview(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
): Promise<void> {
  if (uri) {
    await openPreviewForUri(context, uri);
    return;
  }

  const document = activePreviewableDocument();

  if (active) {
    if (document) {
      await retargetToDocument(context, active, document);
    }
    // Re-read `active`: `retargetToDocument` may have replaced the panel
    // (and therefore this variable) with a freshly created one.
    const current = active;
    if (current) current.panel.reveal(current.panel.viewColumn, true);
    return;
  }

  if (!document) {
    void vscode.window.showInformationMessage(
      'Open a .mk.md (markdown) file to preview it.',
    );
    return;
  }

  await createPreview(context, { kind: 'document', document });
}
