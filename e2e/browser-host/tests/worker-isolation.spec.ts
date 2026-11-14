import { expect, test } from '@playwright/test';

interface Report {
  types: Record<string, string>;
  importScripts: string;
  importScriptsThrows: boolean;
  fetchOtherOrigin: string;
  fetchWasm: string;
  luaValue: unknown;
}

for (const kind of ['module', 'classic'] as const) {
  test(`the packaged ${kind} worker has no network globals after startup, and still ran Lua`, async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('doc')).toBeVisible();
    const report = await page.evaluate(
      (workerKind) =>
        (
          window as unknown as {
            markiiProbeWorker: (kind: string) => Promise<unknown>;
          }
        ).markiiProbeWorker(workerKind) as Promise<Report>,
      kind,
    );

    // The engine ran, so the wasm loaded before the globals were removed.
    expect(report.luaValue).toBe(42);
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
      expect(report.types[name], name).toBe('undefined');
    }
    // importScripts stays a function (the engine detects a worker by it) but
    // cannot load anything.
    expect(report.importScripts).toBe('function');
    expect(report.importScriptsThrows).toBe(true);
    // fetch reads the wasm file and nothing else.
    expect(report.fetchWasm).toBe('ok');
    expect(report.fetchOtherOrigin).toMatch(/^refused:/);
  });
}
