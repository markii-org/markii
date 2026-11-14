import type { HostLabels } from '@markii/host';

/** The VS Code extension's wording nouns: the Markii output channel is its diagnostics surface, and `markii.scriptsDisabled` is the setting that turns scripts back on. */
export const VSCODE_LABELS: HostLabels = {
  appNoun: 'extension',
  previewNoun: 'the Markii preview',
  diagnosticsSurface: 'the Markii output channel',
  deviceNoun: 'this device',
  settingName: 'markii.scriptsDisabled',
};
