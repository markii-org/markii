/**
 * The `@markii/host/node-worker` entry: the worker_threads isolate a Node
 * host spawns by file path. Bundling this file produces the one
 * self-contained worker (`dist/node-worker.js` for the package, a host's
 * own `dist/run/worker.js` for an app that embeds it). It has no exports:
 * loading it starts the worker's message loop.
 */
import './run/worker-entry.js';
