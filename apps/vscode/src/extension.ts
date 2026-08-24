import * as vscode from 'vscode';
import { openPreview, resetScriptGrants, runScripts } from './preview-panel.js';
import { appendPackFolder } from './packs/add-pack-folder.js';

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
 * Extension entry point. Imports `vscode` — deliberately NOT unit-tested
 * (vitest cannot resolve `vscode`); this file is wiring only, registering
 * the commands `package.json`'s `contributes.commands` declares
 * (`markii.openPreview`, `markii.runScripts`, `markii.resetScriptGrants`,
 * `markii.addPackFolder`) and delegating all actual behavior to
 * `preview-panel.ts` and small plain helpers.
 */
export function activate(context: vscode.ExtensionContext): void {
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
  context.subscriptions.push(
    openPreviewCommand,
    runScriptsCommand,
    resetScriptGrantsCommand,
    addPackFolderCommand,
  );
}

export function deactivate(): void {}
