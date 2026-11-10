/**
 * `HostLabels`: the wording nouns every shared behavior module
 * (`./script-execution.ts`, `./refresh-interval.ts`) interpolates, and the
 * one concrete record per app this repo ships. Each app's `HostAdapter`
 * imports its record rather than inventing its own strings, which is what
 * lets one template serve every host.
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

/**
 * The quiet marker a rendered note shows when its `uses:` list names packs
 * this host has not installed (docs/packs.md). One sentence for every host;
 * the tooltip beside it, which says how to install, stays host-specific.
 */
export function packsNotInstalledLabel(missing: readonly string[]): string {
  return missing.length === 1
    ? `Pack not installed: ${missing[0]}`
    : `Packs not installed: ${missing.join(', ')}`;
}
