// @markii/host/node: the half of this package that needs Node, or that
// carries a heavy engine dependency the main entry must not.
//
// The main entry (`./index.ts`) is environment-neutral. This entry adds:
// - the worker_threads isolate and the pinned network provider (`node:*`);
// - the Node-backed file-system seams the neutral code takes by injection;
// - the `@markii/html`-backed static export engine;
// - the pack compile and Export Pack machinery (`esbuild-wasm`);
// - the conformance-runner (reads the corpus from disk).
//
// A Node host imports from both entries. No browser bundle imports this one.

export type { SpawnRunOptions } from './run/run-host.js';
export {
  defaultWorkerPath,
  spawnRunInThread,
  workerThreadIsolate,
} from './run/node-isolate.js';
export { createNetProvider } from './run/net-provider.js';

export {
  createNodeArchiveExtractFs,
  createNodeDirectoryLister,
  createNodeFileReader,
  createNodePackDiscoveryIo,
  createNodeReader as createNodePackScriptsReader,
} from './node-fs.js';
export { createHtmlExportEngine } from './html-engine.js';

export type {
  PackBuildOptions,
  PackBuildOutcome,
  PackBuildSource,
  PackFileReader,
} from './packs/pack-build.js';
export {
  buildPackRegistrationScript,
  buildPackTerminalScript,
  computeCacheKey,
} from './packs/pack-build.js';

// "Export pack" (issue #16): compiles a pack and writes a clean,
// distributable folder at a caller-chosen destination — never inside the
// pack's own source folder. Supersedes issue #15's in-pack-folder
// "build for distribution" behavior, which this replaces entirely.
export type {
  ConfirmPackOverwrite,
  ExportPackOptions,
  PackExportBuilder,
  PackExportFs,
  PackExportOutcome,
} from './packs/pack-export.js';
export { exportPack, resolveExportTarget } from './packs/pack-export.js';

// The archive shape of "export pack" (issue #16): the same build, zipped
// into a single `.mkp` file's bytes instead of written as a folder.
export type {
  ExportPackArchiveOptions,
  PackExportArchiveOutcome,
} from './packs/pack-export-archive.js';
export { exportPackArchive } from './packs/pack-export-archive.js';

export {
  ACTION_CAPABILITY,
  assertHostScenario,
  containsInOrder,
  createAnswerQueue,
  hostConformanceDir,
  hostDeclaresCapability,
  listHostScenarioNames,
  loadHostScenario,
  outcomeMismatches,
  runHostScenario,
  zipArchiveDirectory,
} from './host/conformance-runner.js';
export type {
  HostScenario,
  HostScenarioAction,
  HostScenarioCapability,
  HostScenarioExpected,
  HostScenarioRunResult,
  LoadedHostScenario,
  RunSimulation,
} from './host/conformance-runner.js';
