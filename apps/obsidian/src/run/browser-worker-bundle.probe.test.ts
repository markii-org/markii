/**
 * Executed probe of the REAL Web Worker bundle (AGENTS.md: security- and
 * robustness-relevant behavior gets an executed probe, not only unit
 * assertions on mocks). It builds `dist/worker.browser.js` with the exact
 * options the plugin build uses (`../../esbuild.options.mjs`), loads it
 * under a global surface faithful to an Electron renderer's Web Worker,
 * posts one real job, and requires a real Lua result back.
 *
 * The bug that forced this probe: `decode-named-character-reference`
 * (micromark, via remark-parse) ships a browser build that calls
 * `document.createElement` AT MODULE TOP LEVEL. esbuild's
 * `platform: 'browser'` resolution picked it, the worker died the moment
 * it loaded — before any job arrived — and every Run in the installed
 * plugin settled as a failure the preview then showed nothing for. No
 * unit test caught it because none executed the bundle. This one does,
 * and the shim below deliberately withholds everything a real
 * `DedicatedWorkerGlobalScope` lacks: `document`, `window`, `process`,
 * and `Buffer`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { build } from 'esbuild';
import { workerBuild } from '../../esbuild.options.mjs';
import {
  isNetBridgeRequest,
  serveNetRequest,
  type NetBridgeReply,
} from '@markii/host';
import type { NetProvider } from '@markii/lua';

const outDir = mkdtempSync(path.join(tmpdir(), 'markii-worker-probe-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

it('the built worker bundle loads and completes a Lua run under a worker-faithful global surface', async () => {
  const outfile = path.join(outDir, 'worker.browser.js');
  await build({
    ...workerBuild,
    outfile,
    minify: false,
    sourcemap: false,
    logLevel: 'silent',
  });
  const source = readFileSync(outfile, 'utf8');

  const wasmBytes = readFileSync(
    path.join(repoRoot, 'node_modules', 'wasmoon', 'dist', 'glue.wasm'),
  );
  // The same shape the plugin's `browser-worker.ts` mints: a fresh
  // Uint8Array (never a pooled Buffer view) behind a blob URL.
  const wasmUri = URL.createObjectURL(
    new Blob([new Uint8Array(wasmBytes)], { type: 'application/wasm' }),
  );

  const posted: unknown[] = [];
  let settleResult: (message: unknown) => void = () => {};
  const resultArrived = new Promise<unknown>((resolve) => {
    settleResult = resolve;
  });
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const workerScope = {
    postMessage: (message: unknown) => {
      posted.push(message);
      settleResult(message);
    },
    addEventListener: (
      type: string,
      listener: (event: { data: unknown }) => void,
    ) => {
      if (type === 'message') listeners.push(listener);
    },
    // wasmoon's environment sniffing reads both of these off the worker
    // global; a real DedicatedWorkerGlobalScope has them.
    location: { href: 'blob://markii-probe' },
    constructor: { name: 'DedicatedWorkerGlobalScope' },
    importScripts: () => {
      throw new Error('importScripts is not expected to be called');
    },
  };

  // `document`, `window`, `process`, and `Buffer` are shadowed to
  // `undefined` — exactly what the bundle finds inside a real Web Worker
  // (an Electron renderer's workers run without Node integration). Any
  // top-level touch of them fails THIS line, which is the probe's point.
  const load = new Function(
    'self',
    'location',
    'importScripts',
    'document',
    'window',
    'process',
    'Buffer',
    source,
  ) as (
    self: unknown,
    location: unknown,
    importScripts: unknown,
    document: undefined,
    window: undefined,
    process: undefined,
    buffer: undefined,
  ) => void;
  load(
    workerScope,
    workerScope.location,
    workerScope.importScripts,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  expect(listeners.length).toBeGreaterThan(0);

  const text = [
    '```lua {name=greeting}',
    'return "hello " .. tostring(1 + 2)',
    '```',
    '',
    ':value[greeting]',
    '',
  ].join('\n');
  const job = {
    text,
    trigger: 'manual',
    netAllowlist: [],
    cacheSnapshot: {},
    wasmUri,
  };
  for (const listener of listeners) listener({ data: job });

  const result = (await resultArrived) as {
    values: Record<string, { value?: unknown; status?: string }>;
    failures: { name: string; message: string }[];
  };
  URL.revokeObjectURL(wasmUri);

  expect(result.failures).toEqual([]);
  expect(result.values.greeting?.status).toBe('fresh');
  expect(result.values.greeting?.value).toBe('hello 3');
}, 60_000);

it('a net.fetch_json call crosses the net bridge and comes back as a value', async () => {
  const outfile = path.join(outDir, 'worker.net.js');
  await build({
    ...workerBuild,
    outfile,
    minify: false,
    sourcemap: false,
    logLevel: 'silent',
  });
  const source = readFileSync(outfile, 'utf8');
  const wasmBytes = readFileSync(
    path.join(repoRoot, 'node_modules', 'wasmoon', 'dist', 'glue.wasm'),
  );
  const wasmUri = URL.createObjectURL(
    new Blob([new Uint8Array(wasmBytes)], { type: 'application/wasm' }),
  );

  // A canned provider in place of the real pinned one: the point of this
  // test is the BRIDGE round trip (worker request message -> host
  // serveNetRequest -> reply message -> resolved Lua value), not the
  // network. `serveNetRequest` is the exact host half `browser-isolate.ts`
  // wires up.
  const cannedProvider: NetProvider = {
    get: async (url: string) => ({
      status: 200,
      body: JSON.stringify({ answered: url }),
    }),
  };

  let settleResult: (message: unknown) => void = () => {};
  const resultArrived = new Promise<unknown>((resolve) => {
    settleResult = resolve;
  });
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const workerScope = {
    postMessage: (message: unknown) => {
      if (isNetBridgeRequest(message)) {
        void serveNetRequest(
          message,
          cannedProvider,
          (reply: NetBridgeReply) => {
            // Delivered on a fresh macrotask, the way a real postMessage
            // round trip arrives.
            setTimeout(() => {
              for (const listener of listeners) listener({ data: reply });
            }, 0);
          },
        );
        return;
      }
      settleResult(message);
    },
    addEventListener: (
      type: string,
      listener: (event: { data: unknown }) => void,
    ) => {
      if (type === 'message') listeners.push(listener);
    },
    location: { href: 'blob://markii-probe' },
    constructor: { name: 'DedicatedWorkerGlobalScope' },
    importScripts: () => {
      throw new Error('importScripts is not expected to be called');
    },
  };

  const load = new Function(
    'self',
    'location',
    'importScripts',
    'document',
    'window',
    'process',
    'Buffer',
    source,
  ) as (...args: unknown[]) => void;
  load(
    workerScope,
    workerScope.location,
    workerScope.importScripts,
    undefined,
    undefined,
    undefined,
    undefined,
  );

  const text = [
    '```lua {name=fetched}',
    'local data = net.fetch_json("https://api.example.com/data")',
    'return data.answered',
    '```',
    '',
    ':value[fetched]',
    '',
  ].join('\n');
  const job = {
    text,
    trigger: 'manual',
    netAllowlist: ['api.example.com'],
    cacheSnapshot: {},
    wasmUri,
  };
  for (const listener of listeners) listener({ data: job });

  const result = (await resultArrived) as {
    values: Record<string, { value?: unknown; status?: string }>;
    failures: { name: string; message: string }[];
  };
  URL.revokeObjectURL(wasmUri);

  expect(result.failures).toEqual([]);
  expect(result.values.fetched?.status).toBe('fresh');
  expect(result.values.fetched?.value).toBe('https://api.example.com/data');
}, 60_000);
