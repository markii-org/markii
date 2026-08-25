import { describe, expect, it, vi } from 'vitest';
import { spawnRun } from './run-host';
import { createBrowserIsolate, type WorkerLike } from './browser-isolate';
import { serveNetRequest, type NetBridgeRequest } from './net-bridge';
import { createNetBridge } from './net-bridge-worker';
import type { NetProvider } from '@markii/lua';

/** A Web Worker stand-in: no exit event, terminate is immediate and silent. */
function fakeWorker() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const posted: unknown[] = [];
  let terminated = 0;
  const worker: WorkerLike = {
    postMessage: (m) => {
      posted.push(m);
    },
    terminate: () => {
      terminated += 1;
    },
    addEventListener: (type, listener) => {
      (listeners[type] ??= []).push(listener);
    },
  };
  return {
    worker,
    posted,
    get terminated() {
      return terminated;
    },
    emit: (type: string, data: unknown) => {
      for (const l of listeners[type] ?? []) l({ data, message: data });
    },
  };
}

const job = {
  text: '# x\n',
  netAllowlist: ['api.example.com'],
  cacheSnapshot: {},
  timeoutMs: 1000,
  workerPath: '/plugin/worker.js',
};

const noNet: NetProvider = { get: () => Promise.reject(new Error('unused')) };

describe('the Web Worker isolate', () => {
  it('sends the job with the wasm URL attached', async () => {
    const fake = fakeWorker();
    const spawnIsolate = createBrowserIsolate({
      createWorker: () => fake.worker,
      netProvider: () => noNet,
      wasmUri: 'blob:glue',
    });

    const run = spawnRun({ ...job, spawnIsolate });
    fake.emit('message', { values: {}, failures: [], cacheSnapshot: {} });
    await run;

    expect(fake.posted[0]).toMatchObject({
      text: '# x\n',
      wasmUri: 'blob:glue',
    });
  });

  it('does NOT hang when the watchdog fires, despite there being no exit event', async () => {
    const fake = fakeWorker();
    const spawnIsolate = createBrowserIsolate({
      createWorker: () => fake.worker,
      netProvider: () => noNet,
    });

    // The isolate never replies. A Web Worker reports nothing on
    // terminate(), so the run must settle on the watchdog's own timer.
    const result = await spawnRun({ ...job, timeoutMs: 20, spawnIsolate });

    expect(fake.terminated).toBeGreaterThan(0);
    expect(result.failures[0]).toMatchObject({ kind: 'limit' });
  });

  it('answers a net request with the host provider and never lets the worker do it', async () => {
    const fake = fakeWorker();
    const get = vi.fn(() =>
      Promise.resolve({ status: 200, body: '{"ok":true}' }),
    );
    const netProvider = vi.fn(
      (_allowlist: string[], _maxFetchBytes: number, _policy: unknown) =>
        ({ get }) as unknown as NetProvider,
    );
    const spawnIsolate = createBrowserIsolate({
      createWorker: () => fake.worker,
      netProvider,
    });

    const run = spawnRun({ ...job, spawnIsolate });
    fake.emit('message', {
      kind: 'markii:net-request',
      id: 1,
      method: 'get',
      url: 'https://api.example.com/x',
    });
    await new Promise((r) => setTimeout(r, 10));

    // The provider was built from the JOB's allowlist, not from anything
    // the worker said.
    expect(netProvider.mock.calls[0]?.[0]).toEqual(['api.example.com']);
    expect(get).toHaveBeenCalledWith('https://api.example.com/x');
    expect(fake.posted).toContainEqual(
      expect.objectContaining({ kind: 'markii:net-reply', id: 1, ok: true }),
    );

    fake.emit('message', { values: {}, failures: [], cacheSnapshot: {} });
    await run;
  });

  it('a net request is not mistaken for the run result', async () => {
    const fake = fakeWorker();
    const spawnIsolate = createBrowserIsolate({
      createWorker: () => fake.worker,
      netProvider: () => ({
        get: () => Promise.resolve({ status: 200, body: '' }),
      }),
    });

    const run = spawnRun({ ...job, spawnIsolate });
    fake.emit('message', {
      kind: 'markii:net-request',
      id: 7,
      method: 'get',
      url: 'https://api.example.com/y',
    });
    fake.emit('message', {
      values: { real: 1 },
      failures: [],
      cacheSnapshot: {},
    });

    await expect(run).resolves.toMatchObject({ values: { real: 1 } });
  });

  it('a worker error settles the run rather than hanging', async () => {
    const fake = fakeWorker();
    const spawnIsolate = createBrowserIsolate({
      createWorker: () => fake.worker,
      netProvider: () => noNet,
    });
    const run = spawnRun({ ...job, spawnIsolate });
    fake.emit('error', 'boom');
    await expect(run).resolves.toMatchObject({
      failures: [
        expect.objectContaining({ message: expect.stringContaining('boom') }),
      ],
    });
  });
});

describe('the net bridge', () => {
  it('round-trips a response through the protocol', async () => {
    const host: NetProvider = {
      get: (url) => Promise.resolve({ status: 200, body: `for ${url}` }),
    };
    const bridge: ReturnType<typeof createNetBridge> = createNetBridge(
      (request: NetBridgeRequest) => {
        void serveNetRequest(request, host, (reply) =>
          bridge.handleMessage(reply),
        );
      },
    );
    await expect(bridge.provider.get('https://x.example/a')).resolves.toEqual({
      status: 200,
      body: 'for https://x.example/a',
    });
  });

  it('a host-side refusal comes back branded, so it classifies as capability-denied', async () => {
    const refusing: NetProvider = {
      get: () => Promise.reject(new Error('host not granted')),
    };
    const bridge: ReturnType<typeof createNetBridge> = createNetBridge(
      (request: NetBridgeRequest) => {
        void serveNetRequest(request, refusing, (reply) =>
          bridge.handleMessage(reply),
        );
      },
    );
    await expect(bridge.provider.get('https://nope.example/')).rejects.toThrow(
      'host not granted',
    );
  });

  it('an unknown reply id is ignored rather than throwing', () => {
    const bridge = createNetBridge(() => {});
    expect(() =>
      bridge.handleMessage({ kind: 'markii:net-reply', id: 999, ok: true }),
    ).not.toThrow();
  });
});
