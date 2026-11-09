// @markii/host/node: the half of this package that needs Node, or that
// carries a heavy engine dependency the main entry must not.
//
// The main entry (`./index.ts`) is environment-neutral. This entry adds:
// - the worker_threads isolate and the pinned network provider (`node:*`);
// - the Node-backed file-system seams the neutral code takes by injection;
// - the `@markii/html`-backed static export engine;
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
