/**
 * A debug probe for the e2e suite: it starts the PACKAGED Web Worker, runs a
 * trivial job so the worker's startup lockdown has happened, and then asks
 * the worker what its global scope looks like.
 *
 * The packaged worker is loaded unchanged. A tiny wrapper module worker
 * imports it, then answers one extra `__probe` message from the same global
 * scope, so what is reported is what code inside the real worker would see.
 */
import { createBrowserHostIsolate } from '@markii/host/browser';

export interface WorkerProbeReport {
  readonly types: Record<string, string>;
  readonly importScripts: string;
  readonly importScriptsThrows: boolean;
  readonly fetchOtherOrigin: string;
  readonly fetchWasm: string;
  readonly luaValue: unknown;
}

const WRAPPER = (workerUrl: string): string => `
const names = ['XMLHttpRequest','WebSocket','EventSource','indexedDB','caches','BroadcastChannel','Worker','SharedWorker','WebTransport','WebSocketStream'];
self.addEventListener('message', async (event) => {
  const data = event.data;
  if (!data || data.__probe !== true) return;
  const report = { types: {} };
  for (const name of names) report.types[name] = typeof self[name];
  report.importScripts = typeof importScripts;
  try { importScripts('data:text/javascript,0'); report.importScriptsThrows = false; }
  catch { report.importScriptsThrows = true; }
  try { await fetch(location.origin + '/'); report.fetchOtherOrigin = 'allowed'; }
  catch (error) { report.fetchOtherOrigin = 'refused: ' + String(error && error.message); }
  try { const r = await fetch(data.wasmUri); report.fetchWasm = r.ok ? 'ok' : 'status ' + r.status; }
  catch (error) { report.fetchWasm = 'refused: ' + String(error && error.message); }
  self.postMessage({ __probeReport: report });
});
await import(${JSON.stringify(workerUrl)});
self.postMessage({ __ready: true });
`;

export async function probeWorker(): Promise<WorkerProbeReport> {
  const RealWorker = window.Worker;
  class ProbeWorker extends RealWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      const blob = new Blob([WRAPPER(String(url))], {
        type: 'text/javascript',
      });
      super(URL.createObjectURL(blob), options);
    }
  }
  window.Worker = ProbeWorker;
  try {
    const isolate = createBrowserHostIsolate();
    const spawn = await isolate.spawner();
    const running = spawn({ entryPath: 'probe', maxOldGenerationSizeMb: 64 });
    return await new Promise<WorkerProbeReport>((resolve, reject) => {
      let luaValue: unknown;
      running.onError((error) => reject(error));
      running.onMessage((message) => {
        const data = message as {
          values?: Record<string, { value?: unknown }>;
          __ready?: boolean;
          __probeReport?: Omit<WorkerProbeReport, 'luaValue'>;
        };
        if (data.__ready) {
          running.send({
            text: '```lua {name=sum}\nreturn 20 + 22\n```\n',
            netAllowlist: [],
            cacheSnapshot: {},
            trigger: 'manual',
          });
        } else if (data.__probeReport) {
          running.kill();
          resolve({ ...data.__probeReport, luaValue });
        } else if (data.values) {
          luaValue = data.values.sum?.value;
          running.send({ __probe: true });
        }
      });
    });
  } finally {
    window.Worker = RealWorker;
  }
}
