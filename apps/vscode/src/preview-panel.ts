import * as vscode from 'vscode';
import { createDebouncer } from './debounce.js';
import { isPreviewableDocument, previewTitleFor } from './mark-document.js';
import { isWebviewToHostMessage } from './protocol.js';
import type { HostToWebviewMessage } from './protocol.js';
import { buildWebviewHtml, createNonce } from './webview-html.js';

/**
 * Imports `vscode` — deliberately NOT unit-tested (vitest cannot resolve
 * `vscode`), per the extension's file-scope split. Every piece of logic
 * worth testing in isolation (message validation, debouncing, document
 * classification, HTML/CSP construction) already lives in the plain
 * modules imported above; this file is wiring only.
 */

const VIEW_TYPE = 'markii.preview';
/**
 * The webview DOCUMENT's `<title>` — never visible in the editor (the tab
 * label is `panel.title`, set per document by `postUpdate`), but it is what
 * the webview developer-tools window and screen readers announce.
 */
const DOCUMENT_TITLE = 'Mark Preview';
const DEBOUNCE_MS = 200; // matches apps/playground/src/App.tsx's DEBOUNCE_MS

interface ActivePreview {
  readonly panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  revision: number;
  readonly debouncer: ReturnType<typeof createDebouncer<void>>;
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
 * Sends the tracked document's current text as a fresh `update`, bumping
 * `revision` first so every message this extension ever sends is
 * monotonically numbered — `isNewerRevision` (`protocol.ts`) on the webview
 * side relies on that to ignore anything older than what it already
 * rendered.
 */
function postUpdate(preview: ActivePreview): void {
  // The tab is renamed with every post rather than only on switch: the
  // panel follows the active editor, so its title is the only place a
  // reader can see WHICH document is on screen (an unsaved buffer can also
  // be renamed under us by a save).
  preview.panel.title = previewTitleFor(preview.document.uri.path);
  preview.revision += 1;
  const message: HostToWebviewMessage = {
    type: 'update',
    revision: preview.revision,
    text: preview.document.getText(),
  };
  void preview.panel.webview.postMessage(message);
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
 * document — it would otherwise arrive after this synchronous, immediate
 * post and could stomp the new document's content with stale text — then
 * posts the new document's text right away.
 */
function switchDocument(
  preview: ActivePreview,
  document: vscode.TextDocument,
): void {
  preview.document = document;
  preview.debouncer.cancel();
  postUpdate(preview);
}

function activePreviewableDocument(): vscode.TextDocument | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor && isPreviewableDocument(editor.document)
    ? editor.document
    : undefined;
}

/**
 * Wires up the singleton panel's full lifecycle: the ready/update
 * handshake, following text edits (debounced) and the active editor
 * (immediately), and rehydration when the panel becomes visible again.
 *
 * DECISION — `retainContextWhenHidden: false` plus state rehydration,
 * NOT context retention: retaining context would pin a full React + Mark
 * renderer webview in memory for the entire life of the window, but this
 * extension's ENTIRE state is one string and one revision number. Instead,
 * the webview persists `{text, revision}` via `setState` on every applied
 * update and restores it from `getState()` immediately on (re)load
 * (`webview/preview.tsx`), and this function re-posts the current text
 * below whenever the panel becomes visible again (`onDidChangeViewState`)
 * — so from the user's perspective a tab switch is indistinguishable from
 * true context retention, at no standing memory cost while the panel is
 * hidden.
 */
function createPreview(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
): void {
  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    previewTitleFor(document.uri.path),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
      ],
    },
  );

  setHtml(panel, context);

  const preview: ActivePreview = {
    panel,
    document,
    revision: 0,
    debouncer: createDebouncer<void>(DEBOUNCE_MS, () => {
      postUpdate(preview);
    }),
  };
  active = preview;

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

    // Text edits to the tracked document are debounced (matching the
    // playground's own DEBOUNCE_MS) so a fast typist doesn't flood the
    // webview with one `update` per keystroke.
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== preview.document) return;
      preview.debouncer.schedule();
    }),

    // Following the active editor is immediate, not debounced — switching
    // files should feel instant. A non-previewable editor gaining focus
    // (an Output pane, this very preview panel, a settings UI, ...) is
    // explicitly NOT switched to — the preview keeps showing whatever it
    // was already showing rather than ever going blank.
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!editor || !isPreviewableDocument(editor.document)) return;
      switchDocument(preview, editor.document);
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
  });
}

/**
 * The `markii.openPreview` command handler. Opens a new panel for the
 * active previewable document, or — if a panel is already open — re-targets
 * and reveals it. If nothing previewable is active and no panel exists yet,
 * informs the user instead of opening an empty/blank preview.
 */
export function openPreview(context: vscode.ExtensionContext): void {
  const document = activePreviewableDocument();

  if (active) {
    if (document) {
      switchDocument(active, document);
    }
    active.panel.reveal(active.panel.viewColumn, true);
    return;
  }

  if (!document) {
    void vscode.window.showInformationMessage(
      'Open a .mk.md (markdown) file to preview it.',
    );
    return;
  }

  createPreview(context, document);
}
