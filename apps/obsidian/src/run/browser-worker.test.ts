import { afterEach, describe, expect, it, vi } from 'vitest';

const noNet = { get: async () => ({ status: 501, body: '' }) };

afterEach(() => {
  vi.doUnmock('./embedded-assets.js');
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('createBrowserWorkerSetup', () => {
  it('is undefined while the embed is the empty placeholder', async () => {
    const { createBrowserWorkerSetup } = await import('./browser-worker.js');
    expect(createBrowserWorkerSetup(() => noNet)).toBeUndefined();
  });

  it('keeps the blob URLs alive across the per-run isolate dispose and frees them on its own dispose', async () => {
    vi.resetModules();
    vi.doMock('./embedded-assets.js', () => ({
      EMBEDDED_WORKER_BUNDLE_BASE64: btoa('self.onmessage=()=>{}'),
      EMBEDDED_WASM_GLUE_BASE64: btoa('wasm'),
    }));
    const created: unknown[][] = [];
    class FakeWorker {
      constructor(...args: unknown[]) {
        created.push(args);
      }
      postMessage(): void {}
      terminate(): void {}
      addEventListener(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    const { createBrowserWorkerSetup } = await import('./browser-worker.js');
    const setup = createBrowserWorkerSetup(() => noNet);
    if (!setup) throw new Error('expected a setup');
    expect(setup.isolate.kind).toBe('browser');

    // `createMarkiiHost(...).run` disposes the isolate after every run.
    for (let run = 0; run < 2; run += 1) {
      const spawn = await setup.isolate.spawner();
      spawn({ entryPath: 'x', maxOldGenerationSizeMb: 1 });
      setup.isolate.dispose();
    }
    expect(revoke).not.toHaveBeenCalled();
    // A classic worker: no `{ type: 'module' }` options, the same blob URL both runs.
    expect(created).toHaveLength(2);
    expect(created[0]).toHaveLength(1);
    expect(created[0]).toEqual(created[1]);

    setup.dispose();
    expect(revoke).toHaveBeenCalledTimes(2);
    revoke.mockRestore();
  });
});
