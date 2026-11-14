// @markii/host/node: the half of this package that needs Node, or that
// carries a heavy engine dependency the main entry must not.
//
// The main entry (`./index.ts`) is environment-neutral. This entry adds:
// - the worker_threads isolate and the pinned network provider (`node:*`);
// - the Node-backed file-system seams the neutral code takes by injection;
//
// The `@markii/html`-backed static export engine is its own entry,
// `@markii/host/html-engine`, so importing this one needs no optional peer.
//
// A Node host imports from both entries. No browser bundle imports this one.

export type { SpawnRunOptions } from './run/run-host.js';
export type { NodeHostIsolateOptions } from './run/node-isolate.js';
export {
  createNodeHostIsolate,
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
