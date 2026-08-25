import * as vscode from 'vscode';
import {
  openPreview,
  resetScriptGrants,
  runScripts,
  setDiagnosticsChannel,
} from './preview-panel.js';
import { appendPackFolder } from './packs/add-pack-folder.js';
import {
  parseRefreshIntervalSeconds,
  refreshIntervalValidationMessage,
} from './refresh-interval.js';

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
 * Extension entry point. Imports `vscode` — deliberately NOT unit-tested
 * (vitest cannot resolve `vscode`); this file is wiring only, registering
 * the commands `package.json`'s `contributes.commands` declares
 * (`markii.openPreview`, `markii.runScripts`, `markii.resetScriptGrants`,
 * `markii.addPackFolder`, `markii.enableScheduledRefresh`,
 * `markii.toggleRunOnOpen`, `markii.showDiagnostics`) and delegating all
 * actual behavior to `preview-panel.ts` and small plain helpers.
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
  context.subscriptions.push(
    diagnosticsChannel,
    showDiagnosticsCommand,
    openPreviewCommand,
    runScriptsCommand,
    resetScriptGrantsCommand,
    addPackFolderCommand,
    enableScheduledRefreshCommand,
    toggleRunOnOpenCommand,
  );
}

export function deactivate(): void {}
