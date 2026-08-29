/**
 * Executed probe of the REAL Web Worker bundle (AGENTS.md: security- and
 * robustness-relevant behavior gets an executed probe, not only unit
 * assertions on mocks). It builds the worker bundle with the exact options
 * the plugin build uses (`../../esbuild.options.mjs`'s `workerBuild` — the
 * bundle is no longer written to `dist/` as a file, since it now ships
 * base64-embedded inside `main.js`, so these tests build it to a temporary
 * directory of their own), loads it under a global surface faithful to an
 * Electron renderer's Web Worker, posts one real job, and requires a real
 * Lua result back.
 *
 * The bug that forced this probe: `decode-named-character-reference`
 * (micromark, via remark-parse) ships a browser build that calls
 * `document.createElement` AT MODULE TOP LEVEL. esbuild's
 * `platform: 'browser'` resolution picked it, the worker died the moment
 * it loaded — before any job arrived — and every Run in the installed
 * plugin settled as a failure the preview then showed nothing for. No
 * unit test caught it because none executed the bundle. This one does,
 * and the shim below deliberately withholds what a worker lacks
 * (`document`, `window`) while PROVIDING a Node-shaped `process` —
 * because Obsidian creates its workers WITH Node integration, and
 * wasmoon's environment sniff seeing that `process` sent it down a Node
 * path a blob worker cannot complete (`import('module')`, verified in a
 * real vault). The build banner shadows `process`/`Buffer`/`require` for
 * the whole bundle; these tests fail if that mask ever stops working.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { build } from 'esbuild';
import { buildEmbeddedAssets, workerBuild } from '../../esbuild.options.mjs';
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
  ) as (...args: unknown[]) => void;
  // The `process` handed in mimics Obsidian's node-integrated worker; the
  // bundle's banner must shadow it before wasmoon's environment sniff runs.
  load(
    workerScope,
    workerScope.location,
    workerScope.importScripts,
    undefined,
    undefined,
    { versions: { node: '22.0.0' }, platform: 'linux' },
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
    { versions: { node: '22.0.0' }, platform: 'linux' },
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

/**
 * Executed probe of the REAL embed-to-spawn path: base64 -> bytes -> a
 * blob URL -> a worker that actually starts and completes a Lua run.
 *
 * `main.js` ships the worker bundle and `glue.wasm` as base64
 * (`src/run/embedded-assets.ts`, filled in by `esbuild.options.mjs`'s
 * `embed-runtime-assets` plugin at build time), and `browser-worker.ts`
 * decodes that base64 back into bytes and mints blob URLs from them at
 * plugin load. Every other test in this file builds and executes the
 * worker bundle directly; none of them touch the embed itself. This test
 * calls `buildEmbeddedAssets()` — the exact function the plugin build
 * uses — to get real, production-shaped base64, mocks it in as
 * `embedded-assets.ts`'s exports, and drives the real
 * `createBrowserWorkerSetup()` from `./browser-worker.js` end to end: its
 * own `decodeBase64` call, its own `Blob`/`URL.createObjectURL` call, and
 * a worker spawned from the resulting blob URL. A broken embed — empty,
 * truncated, base64 that doesn't round-trip, or a decode that corrupts a
 * high byte inside the worker bundle or `glue.wasm` — fails THIS test
 * rather than shipping a plugin whose Run button silently does nothing.
 *
 * The worker stand-in fetches the blob URL's bytes with `fetch()`, which
 * works for a `blob:` URL minted by `URL.createObjectURL` under Node 22
 * (verified locally before writing this test), then evaluates the fetched
 * source under the same worker-faithful global shim (`document`/`window`
 * withheld, a Node-shaped `process` provided) the other tests in this file
 * use, and wires `postMessage` in both directions so it behaves like a
 * real `Worker` as far as `@markii/host`'s `createBrowserIsolate` can
 * tell. `browser-worker.ts`'s own decode/blob logic is never bypassed —
 * only the global `Worker` constructor it calls is a stand-in.
 */
it('base64 -> bytes -> blob URL -> a worker that actually starts and completes a Lua run', async () => {
  const embedded = await buildEmbeddedAssets({
    minify: true,
    sourcemap: false,
  });
  expect(embedded.workerBundleBase64.length).toBeGreaterThan(0);
  expect(embedded.wasmGlueBase64.length).toBeGreaterThan(0);

  vi.resetModules();
  vi.doMock('./embedded-assets.js', () => ({
    EMBEDDED_WORKER_BUNDLE_BASE64: embedded.workerBundleBase64,
    EMBEDDED_WASM_GLUE_BASE64: embedded.wasmGlueBase64,
  }));

  type WorkerMessageEvent = { data: unknown };

  /**
   * A `Worker` stand-in that resolves its `blob:` URL to real bytes via
   * `fetch`, then evaluates them under the same worker-faithful shim used
   * elsewhere in this file. `createBrowserIsolate` only calls
   * `postMessage`/`addEventListener('message'/'error'/'messageerror')`/
   * `terminate`, so those are all this needs to implement.
   */
  class FetchingFakeWorker {
    private readonly outboundListeners: ((
      event: WorkerMessageEvent,
    ) => void)[] = [];
    private deliverToWorker: ((message: unknown) => void) | undefined;
    private readonly ready: Promise<void>;

    constructor(url: string) {
      this.ready = this.load(url);
    }

    private async load(url: string): Promise<void> {
      const response = await fetch(url);
      const source = await response.text();
      const inboundListeners: ((event: WorkerMessageEvent) => void)[] = [];
      const workerScope = {
        postMessage: (message: unknown) => {
          for (const listener of this.outboundListeners) {
            listener({ data: message });
          }
        },
        addEventListener: (
          type: string,
          listener: (event: WorkerMessageEvent) => void,
        ) => {
          if (type === 'message') inboundListeners.push(listener);
        },
        location: { href: url },
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
        { versions: { node: '22.0.0' }, platform: 'linux' },
        undefined,
      );
      this.deliverToWorker = (message: unknown) => {
        for (const listener of inboundListeners) listener({ data: message });
      };
    }

    addEventListener(
      type: string,
      listener: (event: WorkerMessageEvent) => void,
    ): void {
      if (type === 'message') this.outboundListeners.push(listener);
    }

    postMessage(message: unknown): void {
      void this.ready.then(() => {
        this.deliverToWorker?.(message);
      });
    }

    terminate(): void {}
  }

  const previousWorker = globalThis.Worker;
  globalThis.Worker = FetchingFakeWorker as unknown as typeof Worker;

  try {
    const { createBrowserWorkerSetup } = await import('./browser-worker.js');

    const dummyNetProvider: NetProvider = {
      get: async () => ({ status: 501, body: '' }),
    };

    const setup = createBrowserWorkerSetup(() => dummyNetProvider);
    if (!setup) throw new Error('expected a defined BrowserWorkerSetup');

    const isolate = setup.spawnIsolate({
      entryPath: 'unused-for-a-blob-worker',
      maxOldGenerationSizeMb: 64,
    });

    const text = [
      '```lua {name=greeting}',
      'return "hello " .. tostring(1 + 2)',
      '```',
      '',
      ':value[greeting]',
      '',
    ].join('\n');

    const resultArrived = new Promise<{
      values: Record<string, { value?: unknown; status?: string }>;
      failures: { name: string; message: string }[];
    }>((resolve) => {
      isolate.onMessage((message) => {
        resolve(
          message as {
            values: Record<string, { value?: unknown; status?: string }>;
            failures: { name: string; message: string }[];
          },
        );
      });
    });

    isolate.send({
      text,
      trigger: 'manual',
      netAllowlist: [],
      cacheSnapshot: {},
    });

    const result = await resultArrived;
    isolate.kill();
    setup.dispose();

    expect(result.failures).toEqual([]);
    expect(result.values.greeting?.status).toBe('fresh');
    expect(result.values.greeting?.value).toBe('hello 3');
  } finally {
    globalThis.Worker = previousWorker;
    vi.doUnmock('./embedded-assets.js');
    vi.resetModules();
  }
}, 60_000);
