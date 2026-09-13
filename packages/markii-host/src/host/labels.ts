/**
 * `HostLabels`: the wording nouns every shared behavior module
 * (`./script-execution.ts`, `./refresh-interval.ts`) interpolates, and the
 * one concrete record per app this repo ships. Each app's `HostAdapter`
 * imports its record rather than inventing its own strings, which is what
 * collapses the survey's near-identical wording pairs (`tmp/W11-survey.md`,
 * section A4) into one template.
 *
 * Pure and dependency-free: re-exported from `../browser.ts` as well as
 * `../index.ts` so VS Code's Node-free webview bundle can read it too.
 */
import type { HostLabels } from './adapter.js';

/** The VS Code extension's labels, taken from its current wording (`apps/vscode/src/script-execution.ts`, `apps/vscode/src/extension.ts`'s output channel). */
export const VSCODE_LABELS: HostLabels = {
  appNoun: 'extension',
  previewNoun: 'the Markii preview',
  diagnosticsSurface: 'the Markii output channel',
  deviceNoun: 'this device',
  settingName: 'markii.scriptsDisabled',
};

/** The Obsidian plugin's labels, taken from its current wording (`apps/obsidian/src/script-execution.ts`, docs/integration.md's host checklist). */
export const OBSIDIAN_LABELS: HostLabels = {
  appNoun: 'plugin',
  previewNoun: 'the Markii preview',
  diagnosticsSurface: 'the Markii diagnostics',
  deviceNoun: 'this device',
};

/** The `markii` command line tool's labels: it has no persistent preview panel, and its diagnostics surface is stderr, gated behind `--verbose` for anything short of a failure (`apps/cli/src/main.ts`). */
export const CLI_LABELS: HostLabels = {
  appNoun: 'command line tool',
  previewNoun: 'the rendered note',
  diagnosticsSurface: 'stderr',
  deviceNoun: 'this device',
};
