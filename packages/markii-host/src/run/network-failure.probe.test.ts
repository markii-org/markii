/**
 * Executed probe through a real worker thread, the real Lua interpreter and
 * the real pinned net provider. A run is a `network` failure only when it
 * ends with the transport failure the provider raised. The message text
 * never decides it.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnRunInThread as spawnRun } from '../dev-isolate';

const WORKER_PATH = path.join(__dirname, 'worker-entry.ts');

function fence(name: string, body: string): string {
  return '```lua {name=' + name + '}\n' + body + '\n```\n';
}

async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function run(body: string, allowlist: string[]) {
  return spawnRun({
    text: fence('a', body),
    netAllowlist: allowlist,
    netPolicy: { allowRestrictedAddresses: true },
    cacheSnapshot: {},
    timeoutMs: 20000,
    workerPath: WORKER_PATH,
  });
}

describe('network failure kind through a real worker', () => {
  it('a refused connection ends the run as network', async () => {
    const port = await closedPort();
    const result = await run(
      `return net.fetch_json("http://127.0.0.1:${String(port)}/x")`,
      ['127.0.0.1'],
    );
    expect(result.values.a?.status).toBe('error');
    expect(result.values.a?.failureKind).toBe('network');
    expect(result.failures[0]?.kind).toBe('network');
  });

  it('error() with the text of that failure is a script error', async () => {
    const port = await closedPort();
    const result = await run(
      `error("request failed: connect ECONNREFUSED 127.0.0.1:${String(port)}")`,
      ['127.0.0.1'],
    );
    expect(result.values.a?.failureKind).toBe('script-error');
  });

  it('a script that catches the failure and then errors itself is a script error', async () => {
    const port = await closedPort();
    const result = await run(
      `local ok, e = pcall(net.fetch_json, "http://127.0.0.1:${String(port)}/x")\nerror("my own bug")`,
      ['127.0.0.1'],
    );
    expect(result.values.a?.failureKind).toBe('script-error');
  });

  it('an ungranted host stays capability-denied', async () => {
    const port = await closedPort();
    const result = await run(
      `return net.fetch_json("http://127.0.0.1:${String(port)}/x")`,
      [],
    );
    expect(result.values.a?.failureKind).toBe('capability-denied');
  });

  it('a redirect to a host off the allowlist stays capability-denied', async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 302;
      res.setHeader('location', 'http://elsewhere.example/');
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as AddressInfo).port;
    try {
      const result = await run(
        `return net.fetch_json("http://127.0.0.1:${String(port)}/x")`,
        ['127.0.0.1'],
      );
      expect(result.values.a?.failureKind).toBe('capability-denied');
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
