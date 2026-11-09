// @markii/pack-build: compiling a pack's sources and exporting the
// prebuilt form. Node only (esbuild-wasm, node:fs, node:crypto). The
// neutral half of the prebuilt-pack convention (file names, shadowing
// detection) stays in @markii/host, which this package imports.

export type {
  PackBuildOptions,
  PackBuildOutcome,
  PackBuildSource,
  PackFileReader,
} from './pack-build.js';
export {
  buildPackRegistrationScript,
  buildPackTerminalScript,
  computeCacheKey,
} from './pack-build.js';

export {
  lintPackCss,
  lintPackCssColors,
  lintPackCssPrefix,
} from './pack-css-lint.js';

// "Export pack" (issue #16): compiles a pack and writes a clean,
// distributable folder at a caller-chosen destination, never inside the
// pack's own source folder.
export type {
  ConfirmPackOverwrite,
  ExportPackOptions,
  PackExportBuilder,
  PackExportFs,
  PackExportOutcome,
} from './pack-export.js';
export { exportPack, resolveExportTarget } from './pack-export.js';

// The archive shape of "export pack": the same build, zipped into a single
// `.mkp` file's bytes instead of written as a folder.
export type {
  ExportPackArchiveOptions,
  PackExportArchiveOutcome,
} from './pack-export-archive.js';
export { exportPackArchive } from './pack-export-archive.js';
