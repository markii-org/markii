import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createNetProvider } from './net-provider';

const servers: http.Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

describe('createNetProvider with an AbortSignal', () => {
  it('destroys a request still waiting for its response when the signal aborts', async () => {
    let closed = false;
    const server = http.createServer((req) => {
      req.socket.on('close', () => {
        closed = true;
      });
      // never answers
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as AddressInfo).port;

    const controller = new AbortController();
    const provider = createNetProvider(
      ['127.0.0.1'],
      1024,
      { allowRestrictedAddresses: true },
      (message) => new Error(message),
      undefined,
      controller.signal,
    );
    const request = provider.get(`http://127.0.0.1:${String(port)}/slow`);
    const settled = request.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    expect(await settled).toMatch(/run has ended/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(closed).toBe(true);
  });

  it('makes no request once the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createNetProvider(
      ['127.0.0.1'],
      1024,
      { allowRestrictedAddresses: true },
      (message) => new Error(message),
      undefined,
      controller.signal,
    );
    await expect(provider.get('http://127.0.0.1:1/')).rejects.toThrow(
      /run has ended/,
    );
  });
});
