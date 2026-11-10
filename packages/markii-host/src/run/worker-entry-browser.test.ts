import { describe, expect, it, vi } from 'vitest';
import { lockdownWorkerGlobals } from './worker-entry-browser';

function fakeScope(realFetch: (...args: unknown[]) => unknown) {
  const scope: Record<string, unknown> = {
    location: { href: 'https://app.test/assets/worker.js' },
    fetch: realFetch,
    XMLHttpRequest: class {},
    WebSocket: class {},
    EventSource: class {},
    indexedDB: {},
    caches: {},
    BroadcastChannel: class {},
    Worker: class {},
    SharedWorker: class {},
    WebTransport: class {},
    WebSocketStream: class {},
    importScripts: () => undefined,
  };
  return scope;
}

describe('lockdownWorkerGlobals', () => {
  it('removes the network globals and keeps importScripts a throwing function', () => {
    const scope = fakeScope(vi.fn());
    lockdownWorkerGlobals(scope, 'https://app.test/glue.wasm');
    for (const name of [
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'indexedDB',
      'caches',
      'BroadcastChannel',
      'Worker',
      'SharedWorker',
      'WebTransport',
      'WebSocketStream',
    ]) {
      expect(scope[name]).toBeUndefined();
    }
    expect(typeof scope.importScripts).toBe('function');
    expect(() => (scope.importScripts as () => void)()).toThrow(
      /not available/,
    );
  });

  it('lets fetch read the glue.wasm URL only', async () => {
    const real = vi.fn(async () => 'wasm');
    const scope = fakeScope(real);
    lockdownWorkerGlobals(scope, 'https://app.test/glue.wasm');
    const guarded = scope.fetch as (input: string) => Promise<unknown>;
    await expect(guarded('https://app.test/glue.wasm')).resolves.toBe('wasm');
    await expect(guarded('/glue.wasm')).resolves.toBe('wasm');
    await expect(guarded('https://evil.test/')).rejects.toThrow(
      /not available/,
    );
    expect(real).toHaveBeenCalledTimes(2);
  });

  it('refuses every fetch when the job named no wasm URL, and is idempotent', async () => {
    const real = vi.fn();
    const scope = fakeScope(real);
    lockdownWorkerGlobals(scope, undefined);
    lockdownWorkerGlobals(scope, 'https://app.test/glue.wasm');
    await expect(
      (scope.fetch as (input: string) => Promise<unknown>)(
        'https://app.test/glue.wasm',
      ),
    ).rejects.toThrow(/not available/);
    expect(real).not.toHaveBeenCalled();
  });

  it('cannot be undone by a script that assigns the globals back', () => {
    const scope = fakeScope(vi.fn());
    lockdownWorkerGlobals(scope, undefined);
    try {
      scope.XMLHttpRequest = class {};
    } catch {
      // strict-mode assignment to a read-only property throws
    }
    expect(scope.XMLHttpRequest).toBeUndefined();
  });
});
