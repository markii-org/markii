// @markii/host/conformance: the host conformance runner. Node only (it reads
// the corpus from disk and drives a real adapter). A host's adapter test
// imports this to run `conformance/host/` against its own `HostAdapter`.
// The corpus ships inside the package at `dist/conformance/host/`.

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
