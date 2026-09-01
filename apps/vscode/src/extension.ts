import * as vscode from 'vscode';
import {
  esbuildBrowserModulePath,
  esbuildWasmBinaryPath,
  exportHtml,
  exportHtmlCascade,
  openPreview,
  packCacheDir,
  resetScriptGrants,
  runScripts,
  setDiagnosticsChannel,
} from './preview-panel.js';
import { appendPackFolder } from './packs/add-pack-folder.js';
import {
  createNodePackExportFs,
  exportNameValidationMessage,
  NO_PACKS_CONFIGURED_MESSAGE,
  packExportDiagnosticLines,
  packExportOverwriteConfirmMessage,
  packExportQuickPickItem,
  packExportResultMessage,
} from './packs/export-pack.js';
import { discoverConfiguredPacks } from './packs/discover-configured-packs.js';
import {
  buildPackRegistrationScript,
  buildComponentCatalog,
  completionAt,
  componentSkeleton,
  exportPack,
  hoverAt,
  offsetToLineColumn,
} from '@markii/host';
import type {
  CompletionItem as MarkCompletionItem,
  DiscoveredPack,
} from '@markii/host';
import { createCatalogCache } from './completion-catalog.js';
import type { CatalogCache } from './completion-catalog.js';
import {
  MARKII_COMPLETION_TRIGGER_CHARACTERS,
  completionFilterText,
  completionItemDetail,
  completionMarkdown,
  completionSortText,
  snippetText,
} from './completion.js';
import {
  parseRefreshIntervalSeconds,
  refreshIntervalValidationMessage,
} from './refresh-interval.js';
import {
  SCRIPTS_DISABLED_CONFIRMATION,
  SCRIPTS_ENABLED_CONFIRMATION,
} from './script-execution.js';
import { isPreviewableDocument } from './mark-document.js';
import {
  insertComponentQuickPickItems,
  INSERT_COMPONENT_QUICK_PICK_PLACEHOLDER,
  INSERT_COMPONENT_QUICK_PICK_TITLE,
  NO_ACTIVE_MARK_EDITOR_MESSAGE,
} from './insert-component.js';
import type { InsertComponentQuickPickEntry } from './insert-component.js';
import {
  completionFenceTextEdits,
  fenceTextEdits,
  isContainerInsertText,
} from './fence-edits.js';
import type { FenceTextEdit } from './fence-edits.js';

/**
 * The `markii.addPackFolder` command: a folder picker that appends the chosen
 * folder to the `markii.packs` setting. Kept here (not in a plain module)
 * because it is all `vscode` API glue; the only decision worth testing, the
 * dedupe/append, lives in `./packs/add-pack-folder.ts`. Writes to the GLOBAL
 * target because `markii.packs` is application-scoped (user settings only),
 * and tells the user to reopen the preview, since a pack is loaded when the
 * panel is (re)created, not live.
 */
async function addPackFolder(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Add Pack Folder',
    title: 'Select a Markii component pack folder',
  });
  const chosen = picked?.[0];
  if (!chosen) return;

  const folderPath = chosen.fsPath;
  const config = vscode.workspace.getConfiguration('markii');
  const existing = config.get<string[]>('packs', []);
  const next = appendPackFolder(existing, folderPath);
  if (!next) {
    void vscode.window.showInformationMessage(
      `Markii: "${folderPath}" is already listed in markii.packs.`,
    );
    return;
  }
  await config.update('packs', next, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(
    'Markii: pack folder added. Reopen the preview to load it.',
  );
}

/**
 * The `markii.enableScheduledRefresh` command: an input box that writes
 * `markii.refreshIntervalSeconds`. Writes to the GLOBAL target because the
 * setting is application-scoped (user settings only, docs/security.md's
 * "opening someone else's project can never start a refresh timer on your
 * behalf" guarantee) — same reasoning as `addPackFolder` above. The interval
 * is only read when a preview (re)creates its panel, so the confirmation
 * message says so rather than implying an already-open preview updates
 * immediately.
 */
async function enableScheduledRefresh(): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: 'Markii: Enable Scheduled Refresh',
    prompt: 'Refresh interval in seconds (values under 5 are treated as 5).',
    placeHolder: '30',
    validateInput: refreshIntervalValidationMessage,
  });
  if (input === undefined) return; // cancelled
  const seconds = parseRefreshIntervalSeconds(input);
  if (seconds === undefined) return; // guarded by validateInput above

  const config = vscode.workspace.getConfiguration('markii');
  await config.update(
    'refreshIntervalSeconds',
    seconds,
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(
    `Markii: scheduled refresh set to ${seconds} second${seconds === 1 ? '' : 's'}. ` +
      'The interval is read when a preview opens, so an already-open preview will not pick this up until you reopen it.',
  );
}

/**
 * The `markii.toggleRunOnOpen` command: flips `markii.runOnOpen` at the
 * GLOBAL target, same reasoning as `addPackFolder` and
 * `enableScheduledRefresh` above — `runOnOpen` is application-scoped so a
 * workspace can never turn it on for the reader. Like scheduled refresh,
 * `runOnOpen` is only read when a preview (re)creates its panel.
 */
async function toggleRunOnOpen(): Promise<void> {
  const config = vscode.workspace.getConfiguration('markii');
  const current = config.get<boolean>('runOnOpen', false);
  const next = !current;
  await config.update('runOnOpen', next, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(
    next
      ? "Markii: run on open turned ON. A note's scripts will run automatically, at the read-only tier, the next time its preview opens. This is read when a preview (re)opens, so an already-open preview is unaffected until you reopen it."
      : 'Markii: run on open turned OFF. An already-open preview keeps its current behavior until you reopen it.',
  );
}

/**
 * The `markii.toggleScriptExecution` command (GitHub issue #34): flips
 * `markii.scriptsDisabled` at the GLOBAL target, same reasoning as
 * `toggleRunOnOpen` above — the setting is application-scoped so a
 * workspace can never turn script execution back on for a reader who
 * turned it off.
 *
 * Unlike run-on-open and the refresh interval, this one is read fresh on
 * every run rather than at panel creation (`preview-panel.ts`'s
 * `scriptsDisabled`), so turning it on stops an already-open preview
 * immediately. That is why the confirmations below do not tell anyone to
 * reopen anything.
 *
 * Turning it back on re-authorizes nothing: the stored grants are
 * untouched in both directions, which is what the "on" confirmation says
 * out loud rather than leaving the reader to wonder.
 */
async function toggleScriptExecution(): Promise<void> {
  const config = vscode.workspace.getConfiguration('markii');
  const disabled = config.get<boolean>('scriptsDisabled', false);
  const next = !disabled;
  await config.update(
    'scriptsDisabled',
    next,
    vscode.ConfigurationTarget.Global,
  );
  void vscode.window.showInformationMessage(
    next ? SCRIPTS_DISABLED_CONFIRMATION : SCRIPTS_ENABLED_CONFIRMATION,
  );
}

/**
 * The `markii.exportPack` command ("Markii: Export Pack", GitHub issue
 * #16): compiles a configured pack and writes a clean, distributable
 * folder — `pack.json`, `webview.js`, `webview.css` when the build emits
 * one, and any `scripts/*.lua` — at a location the user picks. VS Code is
 * the AUTHORING host and owns pack packaging; the pack's own source folder
 * is never written to (see `@markii/host`'s `packs/pack-export.ts`). All
 * the testable pieces (pack discovery, the `PackExportFs`, the quick-pick
 * item shape, the folder-name validator, every user-facing string) live in
 * `./packs/export-pack.ts`; this function is `vscode` wiring only: reads
 * `markii.packs`/the workspace root, offers a quick pick when more than one
 * pack is configured, asks where to export and what to name the folder,
 * and shows the resulting message. The build's warnings and any failure
 * reason are also written to `diagnosticsChannel`, this extension's one
 * diagnostics surface, so the full detail is never only in a transient
 * popup.
 */
async function exportPackCommand(
  context: vscode.ExtensionContext,
  diagnosticsChannel: vscode.OutputChannel,
): Promise<void> {
  const configuredPacks = vscode.workspace
    .getConfiguration('markii')
    .get<string[]>('packs', []);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const packs = await discoverConfiguredPacks(configuredPacks, workspaceRoot);
  if (packs.length === 0) {
    void vscode.window.showInformationMessage(NO_PACKS_CONFIGURED_MESSAGE);
    return;
  }

  let chosen: DiscoveredPack;
  if (packs.length === 1) {
    chosen = packs[0]!;
  } else {
    const items = packs.map(packExportQuickPickItem);
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Markii: Export Pack',
      placeHolder: 'Choose a pack to export',
    });
    if (!picked) return; // cancelled
    const index = items.indexOf(picked);
    chosen = packs[index]!;
  }

  // When only one pack is configured the quick pick above is skipped, so
  // these prompts are the first thing the user sees: each names the chosen
  // pack, or the silent auto-selection reads as "exporting everything".
  const destinationPicked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Export Here',
    title: `Choose where to export the ${chosen.manifest.name} pack`,
  });
  const destinationDir = destinationPicked?.[0]?.fsPath;
  if (!destinationDir) return; // cancelled

  const exportName = await vscode.window.showInputBox({
    title: `Markii: Export the ${chosen.manifest.name} pack`,
    prompt: `Folder name to create for the ${chosen.manifest.name} pack at the chosen destination.`,
    value: chosen.manifest.name,
    validateInput: exportNameValidationMessage,
  });
  if (exportName === undefined) return; // cancelled

  const cacheDir = packCacheDir(context);
  const browserModulePath = esbuildBrowserModulePath(context);
  const wasmBinaryPath = esbuildWasmBinaryPath(context);

  const outcome = await exportPack({
    pack: chosen,
    cacheDir,
    destinationDir,
    exportName,
    build: (pack, dir) =>
      buildPackRegistrationScript(pack, dir, {
        esbuildBrowserModulePath: browserModulePath,
        esbuildWasmBinaryPath: wasmBinaryPath,
      }),
    fs: createNodePackExportFs(),
    confirmOverwrite: async (request) => {
      const choice = await vscode.window.showWarningMessage(
        packExportOverwriteConfirmMessage(request),
        { modal: true },
        'Overwrite',
      );
      return choice === 'Overwrite';
    },
  });

  // Both homes of the outcome, always: the short popup, and the full
  // detail (a failure's verbatim reason, the written paths and byte sizes,
  // any pack-CSS lint warnings) on the diagnostics surface.
  const message = packExportResultMessage(outcome);
  for (const line of packExportDiagnosticLines(outcome)) {
    diagnosticsChannel.appendLine(line);
  }
  if (outcome.kind === 'failed') {
    void vscode.window.showWarningMessage(message);
  } else {
    void vscode.window.showInformationMessage(message);
  }
}

/**
 * A `vscode.QuickPickItem` extended with `catalogIndex`, an extra property
 * that survives `showQuickPick` (which returns the same object it was
 * given), so the chosen row's position in the catalog can be recovered
 * without an `items.indexOf(picked)` lookup, which separators would break.
 * Present only on component rows: a separator carries no catalog entry.
 */
interface InsertComponentQuickPickItem extends vscode.QuickPickItem {
  readonly catalogIndex?: number;
}

/** Maps this command's plain picker entries onto `vscode.QuickPickItem`s, separators via `QuickPickItemKind.Separator`. */
function quickPickItemFromEntry(
  entry: InsertComponentQuickPickEntry,
): InsertComponentQuickPickItem {
  if (entry.kind === 'separator') {
    return { label: entry.label, kind: vscode.QuickPickItemKind.Separator };
  }
  return {
    label: entry.label,
    detail: entry.detail,
    catalogIndex: entry.catalogIndex,
  };
}

/**
 * The `markii.insertComponent` command ("Markii: Insert Component…",
 * GitHub issue #17, slice 1): offers every standard component plus every
 * configured pack's components, and inserts the chosen one's directive
 * skeleton at the cursor. Every testable piece (the quick-pick item shape,
 * every user-facing string) lives in `./insert-component.ts`; the catalog
 * and skeleton builders are `@markii/host`'s (shared with the Obsidian
 * plugin). This function is `vscode` wiring only.
 *
 * A pack-discovery failure never blocks the command: `discoverConfiguredPacks`
 * already degrades quietly (a bad folder is simply skipped, never thrown),
 * so a caught error here still falls back to the standard set alone rather
 * than failing the whole command.
 */
async function insertComponentCommand(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isPreviewableDocument(editor.document)) {
    void vscode.window.showInformationMessage(NO_ACTIVE_MARK_EDITOR_MESSAGE);
    return;
  }

  const configuredPacks = vscode.workspace
    .getConfiguration('markii')
    .get<string[]>('packs', []);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  let packs: Awaited<ReturnType<typeof discoverConfiguredPacks>> = [];
  try {
    packs = await discoverConfiguredPacks(configuredPacks, workspaceRoot);
  } catch {
    packs = [];
  }

  const catalog = buildComponentCatalog(packs);
  const entries = insertComponentQuickPickItems(catalog);
  const items = entries.map(quickPickItemFromEntry);
  const picked = await vscode.window.showQuickPick(items, {
    title: INSERT_COMPONENT_QUICK_PICK_TITLE,
    placeHolder: INSERT_COMPONENT_QUICK_PICK_PLACEHOLDER,
    matchOnDetail: true,
  });
  if (!picked || picked.catalogIndex === undefined) return; // cancelled

  const chosen = catalog[picked.catalogIndex];
  if (!chosen) return;

  const skeleton = componentSkeleton(
    chosen.directiveName,
    chosen.kind,
    chosen.requiredAttributes,
  );
  // `replace` over the whole selection, anchored at its START, rather than
  // `insert` at the active end: with text selected those differ, and the
  // Obsidian plugin's `replaceSelection` already replaces. Anchoring at
  // `start` also keeps the cursor math right for a selection made
  // backwards, where `active` is the earlier position.
  const insertPosition = editor.selection.start;

  // Fence auto-extension: nesting a container inside a container needs the
  // OUTER pair to carry more colons, so the enclosing fences grow in the
  // SAME `editor.edit` as the insertion, making the pair one undo step.
  // Quiet by contract: an ambiguous or unpaired document simply yields no
  // edits and the insertion proceeds exactly as it did before.
  const fenceEdits = fenceTextEdits(
    editor.document.getText(),
    insertPosition.line,
    skeleton.text,
  );

  await editor.edit((editBuilder) => {
    editBuilder.replace(editor.selection, skeleton.text);
    for (const edit of fenceEdits) {
      editBuilder.replace(
        new vscode.Range(
          new vscode.Position(edit.line, edit.startColumn),
          new vscode.Position(edit.line, edit.endColumn),
        ),
        edit.newText,
      );
    }
  });

  const cursor = offsetToLineColumn(skeleton.text, skeleton.cursorOffset);
  const cursorPosition =
    cursor.line === 0
      ? new vscode.Position(
          insertPosition.line,
          insertPosition.character + cursor.column,
        )
      : new vscode.Position(insertPosition.line + cursor.line, cursor.column);
  editor.selection = new vscode.Selection(cursorPosition, cursorPosition);
}

/**
 * The document selector both the completion and hover providers register
 * against: this extension's OWN `markii` language id (declared in
 * `package.json`'s `contributes.languages`), for the two schemes a real
 * editable document can have. Deliberately NOT plain `markdown`: the
 * Insert Component command accepts a `.md` file because the user invoked
 * it explicitly on that file, but a completion popup firing on every `:`
 * in every markdown file in the workspace — most of which are not Markii
 * documents at all — would be intrusive rather than helpful.
 */
const MARKII_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { language: 'markii', scheme: 'file' },
  { language: 'markii', scheme: 'untitled' },
];

/**
 * Maps a slice-1 `CompletionItem.kind` onto a `vscode.CompletionItemKind`
 * for the popup's icon: `component` as `Snippet` (its `insertText` is
 * usually a multi-attribute or multi-line skeleton, not a single token),
 * `attribute` as `Property` (an attribute name on a directive), and
 * `value` as `EnumMember` (one member of an attribute's fixed value set).
 */
function vscodeCompletionItemKind(
  kind: MarkCompletionItem['kind'],
): vscode.CompletionItemKind {
  switch (kind) {
    case 'component':
      return vscode.CompletionItemKind.Snippet;
    case 'attribute':
      return vscode.CompletionItemKind.Property;
    case 'value':
      return vscode.CompletionItemKind.EnumMember;
  }
}

/**
 * Maps one slice-1 `CompletionItem` onto a `vscode.CompletionItem`: label,
 * kind, detail and documentation via `./completion.ts`'s wording, a
 * catalog-order-preserving `sortText`, the escaped/cursor-spliced snippet
 * text, and a range replacing exactly the span `completionAt` reported.
 *
 * An attribute-NAME item also gets a `triggerSuggest` follow-up command:
 * accepting `type=""` lands the cursor between the quotes, which is
 * exactly where value completion should open next, so this reopens the
 * popup immediately instead of making the user press a key first.
 */
function toVscodeCompletionItem(
  item: MarkCompletionItem,
  index: number,
  lineText: string,
  line: number,
  replaceStart: number,
  replaceEnd: number,
  fenceEdits: readonly FenceTextEdit[],
): vscode.CompletionItem {
  const completion = new vscode.CompletionItem(
    item.label,
    vscodeCompletionItemKind(item.kind),
  );
  completion.detail = completionItemDetail(item);
  // Not the label: VS Code scores an item against the text from its own
  // replace range to the cursor, and a directive-name range starts on the
  // colon run. See `completionFilterText`.
  completion.filterText = completionFilterText(
    lineText,
    replaceStart,
    item.label,
  );
  if (item.documentation !== undefined) {
    const markdown = completionMarkdown(item.documentation);
    if (markdown.length > 0) {
      completion.documentation = new vscode.MarkdownString(markdown);
    }
  }
  completion.sortText = completionSortText(index);
  completion.insertText = new vscode.SnippetString(
    snippetText(item.insertText, item.insertCursorOffset),
  );
  completion.range = new vscode.Range(
    new vscode.Position(line, replaceStart),
    new vscode.Position(line, replaceEnd),
  );
  if (item.kind === 'attribute') {
    completion.command = { command: 'editor.action.triggerSuggest', title: '' };
  }
  // Fence auto-extension, the completion half: accepting a CONTAINER item
  // inside an existing container needs the enclosing pair to grow. VS Code
  // applies `additionalTextEdits` in the same undo step as the accepted
  // item, which is exactly the "one undoable edit" this needs. They may
  // not overlap the item's own range: `completionFenceTextEdits` never
  // returns an edit on the insertion line, and the range above is on that
  // line. Only container items carry them; a leaf or inline item accepts
  // without touching anything else in the document.
  if (fenceEdits.length > 0 && isContainerInsertText(item.insertText)) {
    completion.additionalTextEdits = fenceEdits.map((edit) =>
      vscode.TextEdit.replace(
        new vscode.Range(
          new vscode.Position(edit.line, edit.startColumn),
          new vscode.Position(edit.line, edit.endColumn),
        ),
        edit.newText,
      ),
    );
  }
  return completion;
}

/**
 * Builds the `CompletionItemProvider`/`HoverProvider` pair, both reading
 * the cursor's line and the cached catalog and delegating every decision
 * to `@markii/host`'s `completionAt`/`hoverAt` and `./completion.ts`'s
 * wording. Both bodies are wrapped defensively: slice 1 never throws, but
 * a failure anywhere in a provider must degrade to "no completions" /
 * "no hover", never a VS Code error toast.
 */
function createCompletionAndHoverProviders(catalogCache: CatalogCache): {
  completionProvider: vscode.CompletionItemProvider;
  hoverProvider: vscode.HoverProvider;
} {
  const completionProvider: vscode.CompletionItemProvider = {
    async provideCompletionItems(document, position) {
      try {
        const lineText = document.lineAt(position.line).text;
        const catalog = await catalogCache.get();
        const ctx = completionAt(lineText, position.character, catalog);
        if (ctx.kind === 'none' || ctx.items.length === 0) return undefined;
        // Computed once for the whole response, not per row: every
        // container item in one context inserts the same fence shape.
        const fenceEdits = completionFenceTextEdits(
          () => document.getText(),
          position.line,
          ctx.items,
        );
        return ctx.items.map((item, index) =>
          toVscodeCompletionItem(
            item,
            index,
            lineText,
            position.line,
            ctx.replaceStart,
            ctx.replaceEnd,
            fenceEdits,
          ),
        );
      } catch {
        return undefined;
      }
    },
  };

  const hoverProvider: vscode.HoverProvider = {
    async provideHover(document, position) {
      try {
        const lineText = document.lineAt(position.line).text;
        const catalog = await catalogCache.get();
        const info = hoverAt(lineText, position.character, catalog);
        if (info === undefined) return undefined;
        const markdown = completionMarkdown(info.documentation);
        if (markdown.length === 0) return undefined;
        const range = new vscode.Range(
          new vscode.Position(position.line, info.start),
          new vscode.Position(position.line, info.end),
        );
        return new vscode.Hover(new vscode.MarkdownString(markdown), range);
      } catch {
        return undefined;
      }
    },
  };

  return { completionProvider, hoverProvider };
}

/**
 * The catalog cache's `load`: today's configured packs, discovered fresh.
 * Shared shape with `insertComponentCommand`'s own discovery call, kept
 * separate rather than factored together since the two callers have
 * different failure handling (the cache degrades to the standard set and
 * caches nothing on failure; the command just falls back to `[]` inline).
 */
function loadConfiguredPacksForCompletion(): Promise<
  readonly DiscoveredPack[]
> {
  const configuredPacks = vscode.workspace
    .getConfiguration('markii')
    .get<string[]>('packs', []);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return discoverConfiguredPacks(configuredPacks, workspaceRoot);
}

/**
 * Extension entry point. Imports `vscode` — deliberately NOT unit-tested
 * (vitest cannot resolve `vscode`); this file is wiring only, registering
 * the commands `package.json`'s `contributes.commands` declares
 * (`markii.openPreview`, `markii.runScripts`, `markii.resetScriptGrants`,
 * `markii.addPackFolder`, `markii.enableScheduledRefresh`,
 * `markii.toggleRunOnOpen`, `markii.toggleScriptExecution`,
 * `markii.showDiagnostics`,
 * `markii.exportPack`, `markii.insertComponent`, `markii.exportHtml`,
 * `markii.exportHtmlCascade`) and
 * delegating all actual behavior to `preview-panel.ts` and small plain
 * helpers.
 */
export function activate(context: vscode.ExtensionContext): void {
  // The extension's one diagnostics surface (AGENTS.md's "clean is not
  // silent"): created once here and wired into `preview-panel.ts`, which is
  // the only place that ever writes to it (pack load failures today; a
  // future failure class writes here too rather than growing its own
  // channel). Disposed with the extension via `context.subscriptions`, like
  // every other disposable this function creates.
  const diagnosticsChannel = vscode.window.createOutputChannel('Markii');
  setDiagnosticsChannel(diagnosticsChannel);

  const showDiagnosticsCommand = vscode.commands.registerCommand(
    'markii.showDiagnostics',
    () => {
      diagnosticsChannel.show();
    },
  );

  const openPreviewCommand = vscode.commands.registerCommand(
    'markii.openPreview',
    (uri?: vscode.Uri) => {
      void openPreview(context, uri);
    },
  );
  const runScriptsCommand = vscode.commands.registerCommand(
    'markii.runScripts',
    () => {
      void runScripts(context);
    },
  );
  const resetScriptGrantsCommand = vscode.commands.registerCommand(
    'markii.resetScriptGrants',
    () => {
      void resetScriptGrants(context);
    },
  );
  const addPackFolderCommand = vscode.commands.registerCommand(
    'markii.addPackFolder',
    () => {
      void addPackFolder();
    },
  );
  const enableScheduledRefreshCommand = vscode.commands.registerCommand(
    'markii.enableScheduledRefresh',
    () => {
      void enableScheduledRefresh();
    },
  );
  const toggleRunOnOpenCommand = vscode.commands.registerCommand(
    'markii.toggleRunOnOpen',
    () => {
      void toggleRunOnOpen();
    },
  );
  const toggleScriptExecutionCommand = vscode.commands.registerCommand(
    'markii.toggleScriptExecution',
    () => {
      void toggleScriptExecution();
    },
  );
  const exportPackCommandHandle = vscode.commands.registerCommand(
    'markii.exportPack',
    () => {
      void exportPackCommand(context, diagnosticsChannel);
    },
  );
  const insertComponentCommandHandle = vscode.commands.registerCommand(
    'markii.insertComponent',
    () => {
      void insertComponentCommand();
    },
  );
  const exportHtmlCommandHandle = vscode.commands.registerCommand(
    'markii.exportHtml',
    () => {
      void exportHtml(context);
    },
  );
  const exportHtmlCascadeCommandHandle = vscode.commands.registerCommand(
    'markii.exportHtmlCascade',
    () => {
      void exportHtmlCascade(context);
    },
  );

  // Directive autocompletion and hover (GitHub issue #27, slice 2). The
  // cache avoids re-discovering packs from disk on every keystroke; it is
  // invalidated whenever what it would discover could have changed:
  // `markii.packs` edited, or a workspace folder added/removed (packs are
  // discovered relative to the workspace root).
  const catalogCache = createCatalogCache(loadConfiguredPacksForCompletion);
  const { completionProvider, hoverProvider } =
    createCompletionAndHoverProviders(catalogCache);
  const completionProviderHandle =
    vscode.languages.registerCompletionItemProvider(
      MARKII_DOCUMENT_SELECTOR,
      completionProvider,
      ...MARKII_COMPLETION_TRIGGER_CHARACTERS,
    );
  const hoverProviderHandle = vscode.languages.registerHoverProvider(
    MARKII_DOCUMENT_SELECTOR,
    hoverProvider,
  );
  const packsConfigChangeListener = vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (event.affectsConfiguration('markii.packs')) catalogCache.invalidate();
    },
  );
  const workspaceFoldersChangeListener =
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      catalogCache.invalidate();
    });

  context.subscriptions.push(
    diagnosticsChannel,
    showDiagnosticsCommand,
    openPreviewCommand,
    runScriptsCommand,
    resetScriptGrantsCommand,
    addPackFolderCommand,
    enableScheduledRefreshCommand,
    toggleRunOnOpenCommand,
    toggleScriptExecutionCommand,
    exportPackCommandHandle,
    insertComponentCommandHandle,
    exportHtmlCommandHandle,
    exportHtmlCascadeCommandHandle,
    completionProviderHandle,
    hoverProviderHandle,
    packsConfigChangeListener,
    workspaceFoldersChangeListener,
  );
}

export function deactivate(): void {}
