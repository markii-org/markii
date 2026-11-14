/**
 * Label sets the host package's own tests use. Each app owns its real
 * record; these copies exist only so the wording tests need no app.
 */
import type { HostLabels } from './adapter.js';

/** The VS Code extension's labels. */
export const VSCODE_LABELS: HostLabels = {
  appNoun: 'extension',
  previewNoun: 'the Markii preview',
  diagnosticsSurface: 'the Markii output channel',
  deviceNoun: 'this device',
  settingName: 'markii.scriptsDisabled',
};

/** The Obsidian plugin's labels. */
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
