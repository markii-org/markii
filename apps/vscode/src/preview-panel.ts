import * as vscode from 'vscode';
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
} from './bundle-resolve.js';
import type { BundleResolution } from './bundle-resolve.js';
import { createDebouncer } from './debounce.js';
import { isPreviewableDocument, previewTitleFor } from './mark-document.js';
import { isWebviewToHostMessage } from './protocol.js';
import type { HostToWebviewMessage, ValuesMessage } from './protocol.js';
import { isCoveredByRoots, withTrailingSlash } from './resource-roots.js';
import { buildWebviewHtml, createNonce } from './webview-html.js';
import {
  ALLOW_LABEL,
  DONT_ALLOW_LABEL,
  UNKNOWN_HOSTS_PROMPT_MESSAGE,
  bundleAccessPromptMessage,
  clearGrantForDocument,
  hostPromptMessage,
  manyHostsPromptMessage,
} from './run/grant-flow.js';
import { spawnRun } from './run/run-host.js';
import { runOnce } from './run/run-flow.js';
import {
  buildBundleSnapshot,
  decodeBundleCacheFromStorage,
  encodeBundleCacheForStorage,
  withPersistedCache,
} from './run/bundle-run.js';

/**
 * Imports `vscode` — deliberately NOT unit-tested (vitest cannot resolve
 * `vscode`), per the extension's file-scope split. Every piece of logic
 * worth testing in isolation (message validation, debouncing, document
 * classification, bundle resolution, HTML/CSP construction) already lives
 * in the plain modules imported above; this file is wiring and I/O only.
 */

const VIEW_TYPE = 'markii.preview';
/** External wall-clock budget for one `markii.runScripts` press — forwarded verbatim to `spawnRun`'s own watchdog (`run/run-host.ts`); the worker cannot influence or extend it. */
const RUN_TIMEOUT_MS = 15_000;
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
function localResourceRootsFor(
  context: vscode.ExtensionContext,
  source: PreviewSource,
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
  return roots;
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
    const message: HostToWebviewMessage = {
      type: 'update',
      revision: preview.revision,
      text: source.text,
      assets: source.assets,
      readOnly: true,
    };
    void preview.panel.webview.postMessage(message);
    return;
  }

  const baseUri = baseUriForDocument(source.document, preview);
  const message: HostToWebviewMessage = {
    type: 'update',
    revision: preview.revision,
    text: source.document.getText(),
    // Spread rather than `baseUri: undefined`: `postMessage`'s structured
    // clone preserves an own property whose value is `undefined`, and the
    // wire format says a document with no folder OMITS the field.
    ...(baseUri === undefined ? {} : { baseUri }),
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

/** Builds and assigns the webview's HTML, with a FRESH nonce every time — a nonce authorizes exactly one script load and must never be reused across HTML assignments. */
function setHtml(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
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

  webview.html = buildWebviewHtml({
    scriptUri,
    styleUri,
    cspSource: webview.cspSource,
    nonce: createNonce(),
    title: DOCUMENT_TITLE,
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
function retargetToDocument(
  context: vscode.ExtensionContext,
  preview: ActivePreview,
  document: vscode.TextDocument,
): void {
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
  createPreview(
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
function presentSource(
  context: vscode.ExtensionContext,
  source: PreviewSource,
): void {
  if (source.kind === 'document') {
    if (active) {
      retargetToDocument(context, active, source.document);
      const current = active;
      if (current) current.panel.reveal(current.panel.viewColumn, true);
      return;
    }
    createPreview(context, source);
    return;
  }

  const viewColumn = active?.panel.viewColumn;
  active?.panel.dispose();
  createPreview(context, source, viewColumn);
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
function createPreview(
  context: vscode.ExtensionContext,
  source: PreviewSource,
  viewColumn?: vscode.ViewColumn,
): void {
  const roots = localResourceRootsFor(context, source);
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

  setHtml(panel, context);

  const preview: ActivePreview = {
    panel,
    source,
    revision: 0,
    rootKeys: roots.map(rootKey),
    debouncer: createDebouncer<void>(DEBOUNCE_MS, () => {
      postUpdate(preview);
    }),
    running: false,
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
      retargetToDocument(context, preview, editor.document);
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

  panel.onDidDispose(() => {
    preview.debouncer.cancel();
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
    presentSource(context, {
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
    presentSource(context, {
      kind: 'bundle-error',
      title: bundlePreviewTitleFor(bundleName, false),
      message: "This bundle's document could not be found.",
    });
    return;
  }

  await vscode.window.showTextDocument(document, { preview: false });
  presentSource(context, {
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
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(bundleUri);
  } catch {
    presentSource(context, {
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
    presentSource(context, {
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
    presentSource(context, {
      kind: 'bundle-error',
      title: bundlePreviewTitleFor(bundleName, true),
      message: bundleResolutionFailureMessage(resolution.reason),
    });
    return;
  }

  const assets = await extractAssetsAsDataUris(storage);
  presentSource(context, {
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
    presentSource(context, { kind: 'document', document });
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
      memento: context.workspaceState,
      promptHost: promptHostAdapter,
      promptUnknownHosts: promptUnknownHostsAdapter,
      promptManyHosts: promptManyHostsAdapter,
      promptBundleAccess: promptBundleAccessAdapter,
      spawnRun,
      timeoutMs: RUN_TIMEOUT_MS,
      ...(bundleOptions ? { bundle: bundleOptions } : {}),
    });

    // The panel may have been disposed (or replaced by a fresh one — see
    // `retargetToDocument`) while the run above was in flight; `active` no
    // longer being this exact `preview` means there is nothing left to post
    // to, and touching `preview.panel` past disposal would itself throw.
    if (active !== preview) return;

    const message: ValuesMessage = {
      type: 'values',
      revision,
      values: result.values,
      failures: result.failures,
    };
    // Awaited (not fire-and-forget) so a rejection here — e.g. a disposal
    // racing this exact call — lands in the catch below instead of becoming
    // its own unhandled rejection.
    await preview.panel.webview.postMessage(message);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('markii.runScripts failed:', detail);
    // Quiet, stack-free message — AGENTS.md's cleanliness principle: the
    // rendered page (and its surrounding UI) shows quiet markers, never
    // error dumps or machinery.
    void vscode.window.showErrorMessage(
      "Markii: running this note's scripts failed.",
    );
  } finally {
    preview.running = false;
  }
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
export function openPreview(
  context: vscode.ExtensionContext,
  uri?: vscode.Uri,
): void {
  if (uri) {
    void openPreviewForUri(context, uri);
    return;
  }

  const document = activePreviewableDocument();

  if (active) {
    if (document) {
      retargetToDocument(context, active, document);
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

  createPreview(context, { kind: 'document', document });
}
