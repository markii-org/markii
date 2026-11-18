/**
 * Executed probe for host-set request headers. Real local servers, the real
 * pinned provider, and a real worker thread with real Lua.
 *
 * Three rules are held here:
 * - headers attach only when a hop's origin equals the key exactly, and a
 *   redirect to another origin (even an allowed one) carries none;
 * - header values never appear in anything posted to the isolate, for the
 *   worker-thread isolate and for the Web Worker isolate;
 * - headers attach to GET only.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnRunInThread } from '../dev-isolate';
import { createFetchNetProvider } from '../browser';
import { createBrowserIsolate, type WorkerLike } from './browser-isolate';
import { createWorkerThreadIsolate, workerThreadIsolate } from './node-isolate';
import { devWorkerIsolate } from '../dev-isolate';
import { normalizeNodeHostHeaders, createNetProvider } from './net-provider';

const WORKER_PATH = path.join(__dirname, 'worker-entry.ts');
const SECRET = 'Bearer s3cr3t-token-value';

interface Seen {
  method: string;
  authorization: string | undefined;
  xKey: string | undefined;
}

interface Local {
  origin: string;
  seen: Seen[];
  close: () => Promise<void>;
}

async function serve(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<Local> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    seen.push({
      method: req.method ?? '',
      authorization: req.headers.authorization,
      xKey: req.headers['x-key'] as string | undefined,
    });
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const json = (_req: http.IncomingMessage, res: http.ServerResponse): void => {
  res.setHeader('content-type', 'application/json');
  res.end('{"ok":true}');
};

const open: Local[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(open.splice(0).map((s) => s.close()));
});
async function start(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<Local> {
  const s = await serve(handler);
  open.push(s);
  return s;
}

function nodeProvider(headers: Record<string, Record<string, string>>) {
  return createNetProvider(
    ['127.0.0.1'],
    1_000_000,
    { allowRestrictedAddresses: true },
    (message) => new Error(message),
    undefined,
    undefined,
    normalizeNodeHostHeaders(headers),
  );
}

describe('rule 1: headers attach only on an exact origin match, per hop', () => {
  it('a redirect from the keyed origin to another allowed origin carries no host headers', async () => {
    const target = await start(json);
    const keyed = await start((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${target.origin}/next`);
      res.end();
    });
    const net = nodeProvider({ [keyed.origin]: { Authorization: SECRET } });
    const response = await net.get(`${keyed.origin}/start`);
    expect(response.status).toBe(200);
    expect(keyed.seen[0]?.authorization).toBe(SECRET);
    expect(target.seen).toHaveLength(1);
    expect(target.seen[0]?.authorization).toBeUndefined();
  });

  it('a redirect from an unkeyed origin to the keyed one does attach on that hop', async () => {
    const keyed = await start(json);
    const first = await start((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', `${keyed.origin}/x`);
      res.end();
    });
    const net = nodeProvider({ [keyed.origin]: { Authorization: SECRET } });
    await net.get(`${first.origin}/start`);
    expect(first.seen[0]?.authorization).toBeUndefined();
    expect(keyed.seen[0]?.authorization).toBe(SECRET);
  });

  it('the same host on another port does not match', async () => {
    const server = await start(json);
    const other = new URL(server.origin);
    const wrongPort = `http://127.0.0.1:${String(Number(other.port) + 1)}`;
    const net = nodeProvider({ [wrongPort]: { Authorization: SECRET } });
    await net.get(`${server.origin}/x`);
    expect(server.seen[0]?.authorization).toBeUndefined();
  });

  it('the same host under another scheme does not match', async () => {
    const server = await start(json);
    const asHttps = server.origin.replace('http:', 'https:');
    const net = nodeProvider({ [asHttps]: { Authorization: SECRET } });
    await net.get(`${server.origin}/x`);
    expect(server.seen[0]?.authorization).toBeUndefined();
  });

  it('the browser provider matches the origin exactly and drops nothing else', async () => {
    const calls: Array<{ url: string; headers: unknown }> = [];
    const fake = (async (url: string, init: { headers?: unknown }) => {
      calls.push({ url, headers: init.headers });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createFetchNetProvider({
      allowedOrigins: ['https://a.example', 'https://b.example'],
      headers: { 'https://a.example': { Authorization: SECRET } },
      fetch: fake,
    })(['a.example', 'b.example'], 1000, {});
    await provider.get('https://a.example/x');
    await provider.get('https://b.example/x');
    expect(calls[0]?.headers).toEqual({ authorization: SECRET });
    expect(calls[1]?.headers).toBeUndefined();
  });
});

describe('rule 2: header values never reach the isolate', () => {
  it('a real worker thread run reaches the keyed server with the header and never receives it', async () => {
    const server = await start(json);
    const posted: string[] = [];
    const original = Worker.prototype.postMessage;
    vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (
      this: Worker,
      ...args: Parameters<Worker['postMessage']>
    ) {
      posted.push(JSON.stringify(args[0]));
      return original.apply(this, args);
    });
    const headers = normalizeNodeHostHeaders({
      [server.origin]: { Authorization: SECRET },
    });
    const isolate = createWorkerThreadIsolate(headers);
    const result = await spawnRunInThread({
      text:
        '```lua {name=a}\nreturn net.fetch_json("' +
        server.origin +
        '/x")\n```\n',
      netAllowlist: ['127.0.0.1'],
      netPolicy: { allowRestrictedAddresses: true },
      cacheSnapshot: {},
      timeoutMs: 20000,
      workerPath: WORKER_PATH,
      spawnIsolate: (options) =>
        isolate({
          ...options,
          // The dev isolate adds the tsx loader for a .ts entry.
          execArgv: ['--require', 'tsx/cjs'],
        }),
    });
    expect(result.failures).toEqual([]);
    expect(server.seen[0]?.authorization).toBe(SECRET);
    expect(posted.length).toBeGreaterThan(1);
    expect(posted.join('\n')).not.toContain('s3cr3t');
    expect(JSON.stringify(result)).not.toContain('s3cr3t');
  }, 40_000);

  it('the default node isolate still serves net on the host side', async () => {
    const server = await start(json);
    const result = await spawnRunInThread({
      text:
        '```lua {name=a}\nreturn net.fetch_json("' +
        server.origin +
        '/x")\n```\n',
      netAllowlist: ['127.0.0.1'],
      netPolicy: { allowRestrictedAddresses: true },
      cacheSnapshot: {},
      timeoutMs: 20000,
      workerPath: WORKER_PATH,
      spawnIsolate: devWorkerIsolate,
    });
    expect(result.values.a?.value).toEqual({ ok: true });
    expect(server.seen[0]?.authorization).toBeUndefined();
    expect(typeof workerThreadIsolate).toBe('function');
  }, 40_000);

  it('the Web Worker isolate posts no header value to the worker', async () => {
    const listeners: Array<(event: unknown) => void> = [];
    const posted: string[] = [];
    const worker: WorkerLike = {
      postMessage: (message) => {
        posted.push(JSON.stringify(message));
      },
      terminate: () => {},
      addEventListener: (type, listener) => {
        if (type === 'message') listeners.push(listener);
      },
    };
    const sent: Array<{ url: string; headers: unknown }> = [];
    const fake = (async (url: string, init: { headers?: unknown }) => {
      sent.push({ url, headers: init.headers });
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    const factory = createFetchNetProvider({
      allowedOrigins: ['https://api.example'],
      headers: { 'https://api.example': { Authorization: SECRET } },
      fetch: fake,
    });
    const isolate = createBrowserIsolate({
      createWorker: () => worker,
      netProvider: factory,
    })({ entryPath: 'x', maxOldGenerationSizeMb: 128 });
    isolate.send({
      netAllowlist: ['api.example'],
      limits: {},
      text: 'x',
    });
    for (const listener of listeners) {
      listener({
        data: {
          kind: 'markii:net-request',
          id: 1,
          method: 'get',
          url: 'https://api.example/data',
        },
      });
    }
    await vi.waitFor(() => {
      expect(posted.length).toBeGreaterThan(1);
    });
    expect(sent[0]?.headers).toEqual({ authorization: SECRET });
    expect(posted.join('\n')).not.toContain('s3cr3t');
  });
});

describe('rule 3: headers attach to GET only', () => {
  it('POST and PATCH to the keyed origin carry no host headers (node)', async () => {
    const server = await start(json);
    const net = nodeProvider({ [server.origin]: { Authorization: SECRET } });
    await net.get(`${server.origin}/x`);
    await net.post?.(`${server.origin}/x`, 'a');
    await net.patch?.(`${server.origin}/x`, 'b');
    expect(server.seen.map((s) => [s.method, s.authorization])).toEqual([
      ['GET', SECRET],
      ['POST', undefined],
      ['PATCH', undefined],
    ]);
  });

  it('POST and PATCH carry no host headers (browser provider)', async () => {
    const calls: Array<{ method: string; headers: unknown }> = [];
    const fake = (async (
      _url: string,
      init: { method: string; headers?: unknown },
    ) => {
      calls.push({ method: init.method, headers: init.headers });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createFetchNetProvider({
      allowedOrigins: ['https://a.example'],
      headers: { 'https://a.example': { Authorization: SECRET } },
      fetch: fake,
    })(['a.example'], 1000, {});
    await provider.post?.('https://a.example/x', 'a');
    await provider.patch?.('https://a.example/x', 'b');
    for (const call of calls) {
      expect(JSON.stringify(call.headers)).not.toContain('s3cr3t');
    }
  });
});
