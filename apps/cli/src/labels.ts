import type { HostLabels } from '@markii/host';

/** The `markii` command line tool's wording nouns: it has no persistent preview, and its diagnostics surface is stderr, gated behind `--verbose` for anything short of a failure. */
export const CLI_LABELS: HostLabels = {
  appNoun: 'command line tool',
  previewNoun: 'the rendered note',
  diagnosticsSurface: 'stderr',
  deviceNoun: 'this device',
};
