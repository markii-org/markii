/**
 * A debug probe for the e2e suite: it starts the PACKAGED Web Worker, runs a
 * trivial job so the worker's startup lockdown has happened, and then asks
 * the worker what its global scope looks like.
 *
 * The packaged worker is loaded unchanged, either the module build or the
 * classic build. A tiny wrapper worker loads it (`import` for the module
 * build, `importScripts` for the classic one), then answers one extra `__probe` message from the same global
 * scope, so what is reported is what code inside the real worker would see.
 */
import { createBrowserHostIsolate } from '@markii/host/browser';
import classicWorkerUrl from '@markii/host/browser-worker-classic?url';

/** The two packaged builds: the ES module worker and the classic (IIFE) one. */
export type WorkerProbeKind = 'module' | 'classic';

export interface WorkerProbeReport {
  readonly types: Record<string, string>;
  readonly importScripts: string;
  readonly importScriptsThrows: boolean;
  readonly fetchOtherOrigin: string;
  readonly fetchWasm: string;
  /** Each name still usable through an object on the global's prototype chain, as `name@constructor`. Empty when every prototype holds only the locked forms: no removed name, a `fetch` that refuses other URLs and an `importScripts` that throws. */
  readonly chainExposes: string[];
  /** How many objects the prototype chain walk visited, so a test can tell an empty result from a walk that never ran. */
  readonly chainLength: number;
  readonly luaValue: unknown;
}

const WRAPPER_BODY = `
const names = ['XMLHttpRequest','WebSocket','EventSource','indexedDB','caches','BroadcastChannel','Worker','SharedWorker','WebTransport','WebSocketStream'];
self.addEventListener('message', async (event) => {
  const data = event.data;
  if (!data || data.__probe !== true) return;
  const report = { types: {} };
  for (const name of names) report.types[name] = typeof self[name];
  // Every prototype the global inherits from must hold only the locked
  // forms: no usable network constructor, a fetch that refuses other URLs,
  // and an importScripts that throws.
  report.chainExposes = [];
  report.chainLength = 0;
  for (let proto = Object.getPrototypeOf(self); proto !== null && report.chainLength < 16; proto = Object.getPrototypeOf(proto)) {
    report.chainLength += 1;
    const label = (proto.constructor && proto.constructor.name) || String(report.chainLength);
    for (const name of names) {
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (d !== undefined && (d.get !== undefined || d.set !== undefined || d.value !== undefined)) report.chainExposes.push(name + '@' + label);
    }
    const fetchDescriptor = Object.getOwnPropertyDescriptor(proto, 'fetch');
    if (fetchDescriptor !== undefined) {
      if (typeof fetchDescriptor.value !== 'function') report.chainExposes.push('fetch@' + label);
      else {
        try { await fetchDescriptor.value.call(self, location.origin + '/'); report.chainExposes.push('fetch@' + label); }
        catch (error) { /* refused, as it must be */ }
      }
    }
    const importDescriptor = Object.getOwnPropertyDescriptor(proto, 'importScripts');
    if (importDescriptor !== undefined) {
      if (typeof importDescriptor.value !== 'function') report.chainExposes.push('importScripts@' + label);
      else {
        try { importDescriptor.value.call(self, 'data:text/javascript,0'); report.chainExposes.push('importScripts@' + label); }
        catch (error) { /* throws, as it must */ }
      }
    }
  }
  report.importScripts = typeof importScripts;
  try { importScripts('data:text/javascript,0'); report.importScriptsThrows = false; }
  catch { report.importScriptsThrows = true; }
  try { await fetch(location.origin + '/'); report.fetchOtherOrigin = 'allowed'; }
  catch (error) { report.fetchOtherOrigin = 'refused: ' + String(error && error.message); }
  try { const r = await fetch(data.wasmUri); report.fetchWasm = r.ok ? 'ok' : 'status ' + r.status; }
  catch (error) { report.fetchWasm = 'refused: ' + String(error && error.message); }
  self.postMessage({ __probeReport: report });
});
`;

const wrapperFor = (kind: WorkerProbeKind, workerUrl: string): string =>
  kind === 'module'
    ? `${WRAPPER_BODY}await import(${JSON.stringify(workerUrl)});\nself.postMessage({ __ready: true });\n`
    : `${WRAPPER_BODY}importScripts(${JSON.stringify(workerUrl)});\nself.postMessage({ __ready: true });\n`;

export async function probeWorker(
  kind: WorkerProbeKind = 'module',
): Promise<WorkerProbeReport> {
  const RealWorker = window.Worker;
  class ProbeWorker extends RealWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      const absolute = new URL(String(url), window.location.href).href;
      const blob = new Blob([wrapperFor(kind, absolute)], {
        type: 'text/javascript',
      });
      super(URL.createObjectURL(blob), options);
    }
  }
  window.Worker = ProbeWorker;
  try {
    const isolate =
      kind === 'module'
        ? createBrowserHostIsolate()
        : createBrowserHostIsolate({
            workerType: 'classic',
            workerUrl: classicWorkerUrl,
          });
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
