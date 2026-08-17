import * as vscode from 'vscode';
import { openPreview } from './preview-panel.js';

/**
 * Extension entry point. Imports `vscode` — deliberately NOT unit-tested
 * (vitest cannot resolve `vscode`); this file is wiring only, registering
 * the one command `package.json`'s `contributes.commands` declares
 * (`markii.openPreview`) and delegating all actual behavior to
 * `preview-panel.ts`.
 */
export function activate(context: vscode.ExtensionContext): void {
  const openPreviewCommand = vscode.commands.registerCommand(
    'markii.openPreview',
    () => {
      openPreview(context);
    },
  );
  context.subscriptions.push(openPreviewCommand);
}

export function deactivate(): void {}
