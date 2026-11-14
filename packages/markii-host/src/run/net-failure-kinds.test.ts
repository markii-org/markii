import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createNetProvider } from './net-provider.js';
import { isNetRefusal } from './net-refusal.js';
import { serveNetRequest, type NetBridgeReply } from './net-bridge.js';

const servers: http.Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

const allowLoopback = { allowRestrictedAddresses: true };
const plain = (message: string): Error => new Error(message);

async function failureOf(call: Promise<unknown>): Promise<Error> {
  try {
    await call;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('the request was expected to fail');
}

async function closedLoopbackPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function replyFor(
  provider: ReturnType<typeof createNetProvider>,
  url: string,
): Promise<NetBridgeReply> {
  let reply: NetBridgeReply | undefined;
  await serveNetRequest(
    { kind: 'markii:net-request', id: 1, method: 'get', url },
    provider,
    (r) => {
      reply = r;
    },
  );
  if (!reply) throw new Error('no reply was posted');
  return reply;
}

describe('createNetProvider failure kinds', () => {
  it('marks an unlisted host as a policy refusal', async () => {
    const provider = createNetProvider(
      ['127.0.0.1'],
      1024,
      allowLoopback,
      plain,
    );
    const error = await failureOf(provider.get('http://other.example/'));
    expect(isNetRefusal(error)).toBe(true);
    expect(error.message).toMatch(/allowlist/);
  });

  it('marks a restricted address range as a policy refusal', async () => {
    const provider = createNetProvider(
      ['internal.example'],
      1024,
      { allowRestrictedAddresses: false },
      plain,
      async () => [{ address: '10.0.0.5', family: 4 }],
    );
    const error = await failureOf(provider.get('http://internal.example/'));
    expect(isNetRefusal(error)).toBe(true);
  });

  it('marks an over-size body as a policy refusal', async () => {
    const server = http.createServer((_req, res) => {
      res.end('x'.repeat(5000));
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as AddressInfo).port;
    const provider = createNetProvider(
      ['127.0.0.1'],
      100,
      allowLoopback,
      plain,
    );
    const error = await failureOf(
      provider.get(`http://127.0.0.1:${String(port)}/`),
    );
    expect(isNetRefusal(error)).toBe(true);
  });

  it('leaves a refused connection as a plain failure with the reason', async () => {
    const port = await closedLoopbackPort();
    const provider = createNetProvider(
      ['127.0.0.1'],
      1024,
      allowLoopback,
      plain,
    );
    const error = await failureOf(
      provider.get(`http://127.0.0.1:${String(port)}/`),
    );
    expect(isNetRefusal(error)).toBe(false);
    expect(error.message).toMatch(/^request failed: /);
  });

  it('leaves a name that does not resolve as a plain failure', async () => {
    const provider = createNetProvider(
      ['gone.example'],
      1024,
      { allowRestrictedAddresses: false },
      plain,
      async () => {
        throw new Error('ENOTFOUND');
      },
    );
    const error = await failureOf(provider.get('http://gone.example/'));
    expect(isNetRefusal(error)).toBe(false);
    expect(error.message).toMatch(/could not be resolved/);
  });

  it('leaves an aborted run as a plain failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createNetProvider(
      ['127.0.0.1'],
      1024,
      allowLoopback,
      plain,
      undefined,
      controller.signal,
    );
    const error = await failureOf(provider.get('http://127.0.0.1:1/'));
    expect(isNetRefusal(error)).toBe(false);
  });
});

describe('the net bridge keeps the two failure kinds apart', () => {
  it('sends a policy refusal as a denial and a transport failure as an ordinary failure', async () => {
    const port = await closedLoopbackPort();
    const provider = createNetProvider(
      ['127.0.0.1'],
      1024,
      allowLoopback,
      plain,
    );
    const refused = await replyFor(provider, 'http://other.example/');
    expect(refused.ok).toBe(false);
    expect(refused.denied).toBe(true);

    const transport = await replyFor(
      provider,
      `http://127.0.0.1:${String(port)}/`,
    );
    expect(transport.ok).toBe(false);
    expect(transport.denied).toBe(false);
    expect(transport.error).toMatch(/request failed/);
  });

  it('never reports a failure as a success', async () => {
    const provider = {
      get: async () => {
        throw 'plain string';
      },
    };
    let reply: NetBridgeReply | undefined;
    await serveNetRequest(
      { kind: 'markii:net-request', id: 2, method: 'get', url: 'x' },
      provider,
      (r) => {
        reply = r;
      },
    );
    expect(reply?.ok).toBe(false);
    expect(reply?.response).toBeUndefined();
  });
});
