/**
 * ISSUE #10 PROBE — live proof that `createNetProvider` (`./worker-entry.ts`)
 * actually pins a request's socket to the address `pinHostAddress`
 * (`./net-pinning.ts`) vets, against a REAL `node:http` server and a REAL
 * request, not a mock. Follows `pentest-probe.test.ts`'s conventions: a real
 * local server with a request counter, real network calls, the property
 * under test proven by the counter staying at 0 rather than by inspecting
 * internals.
 *
 * `createNetProvider` is exercised directly here (not through `spawnRun`'s
 * full worker/Lua path): its `lookup` parameter is a plain JS function, and
 * a `worker_threads` job message is structured-cloned, so a function cannot
 * cross that boundary at all. Driving the provider directly is what makes
 * an injected, deterministic resolver possible for this test while still
 * exercising the REAL `node:http`/`node:https` request path this module
 * built (issue #10's actual subject).
 */
import * as http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { isNetProviderDenial, netProviderDenial } from '@markii/lua';
import { createNetProvider } from './net-provider';
import type { HostLookup, ResolvedAddress } from './net-pinning';

interface LocalServer {
  port: number;
  hits: () => number;
  close: () => Promise<void>;
}

async function startServer(): Promise<LocalServer> {
  let hitCount = 0;
  const server = http.createServer((_req, res) => {
    hitCount += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no port');
  return {
    port: addr.port,
    hits: () => hitCount,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function lookupTo(address: ResolvedAddress): HostLookup {
  return async () => [address];
}

let server: LocalServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('issue #10: a public-looking name rebound to a private address is refused', () => {
  it('the request never reaches the server (hit count stays 0) under the default policy', async () => {
    server = await startServer();
    const { port } = server;

    // "api.example.com" is the name the run granted; the injected lookup is
    // what a rebinding attacker controls — it answers with the loopback
    // address the real server happens to be listening on. A hostname
    // allowlist alone cannot see this; `pinHostAddress` is what closes it.
    const net = createNetProvider(
      ['api.example.com'],
      1_000_000,
      { allowRestrictedAddresses: false },
      netProviderDenial,
      lookupTo({ address: '127.0.0.1', family: 4 }),
    );

    await expect(net.get(`http://api.example.com:${port}/x`)).rejects.toSatisfy(
      (err: unknown) => isNetProviderDenial(err),
    );

    expect(server.hits()).toBe(0);
  });

  it('the opt-in (allowRestrictedAddresses) lets the identical request through', async () => {
    server = await startServer();
    const { port } = server;

    const net = createNetProvider(
      ['api.example.com'],
      1_000_000,
      { allowRestrictedAddresses: true },
      netProviderDenial,
      lookupTo({ address: '127.0.0.1', family: 4 }),
    );

    const response = await net.get(`http://api.example.com:${port}/x`);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });
    expect(server.hits()).toBe(1);
  });
});

describe('issue #10: a redirect landing on a rebound host is refused before that hop is requested', () => {
  it('the redirect target (resolved into a private range) is never contacted', async () => {
    const target = await startServer();
    const redirectingServer = http.createServer((_req, res) => {
      res.writeHead(302, {
        location: 'http://internal.example.com/secret',
      });
      res.end();
    });
    await new Promise<void>((resolve) =>
      redirectingServer.listen(0, '127.0.0.1', resolve),
    );
    const redirectAddr = redirectingServer.address();
    if (redirectAddr === null || typeof redirectAddr === 'string') {
      throw new Error('no port');
    }

    try {
      // Both hosts are on the allowlist (a redirect staying within granted
      // hosts is ordinarily fine — B-1 is about hosts LEAVING the
      // allowlist); the point here is that even a GRANTED host's resolved
      // address is still vetted, on every hop, not just the first.
      const net = createNetProvider(
        ['127.0.0.1', 'internal.example.com'],
        1_000_000,
        { allowRestrictedAddresses: false },
        netProviderDenial,
        async (hostname: string) => {
          if (hostname === '127.0.0.1')
            return [{ address: '127.0.0.1', family: 4 }];
          if (hostname === 'internal.example.com') {
            // The rebinding shape: a public-looking redirect target name
            // resolves into a private-range address (loopback, here) —
            // refused on ITS OWN resolution even though "127.0.0.1" is
            // separately grantable as a literal elsewhere in this same
            // allowlist.
            return [{ address: '127.0.0.1', family: 4 }];
          }
          throw new Error(`unexpected lookup for ${hostname}`);
        },
      );

      await expect(
        net.get(`http://127.0.0.1:${redirectAddr.port}/start`),
      ).rejects.toSatisfy((err: unknown) => isNetProviderDenial(err));

      expect(target.hits()).toBe(0);
    } finally {
      await new Promise<void>((resolve) =>
        redirectingServer.close(() => resolve()),
      );
      await target.close();
    }
  });
});

/**
 * Wire-fidelity of the `fetch` -> `node:http`/`node:https` port (issue #10).
 *
 * Porting the provider off `fetch` meant this code builds every request
 * header itself, and `fetch`'s own defaults silently stopped being sent. That
 * is invisible to a local-server test that only asserts on status and body,
 * but it is not invisible to real APIs: with no `user-agent`, api.github.com
 * answers 403 ("Please make sure your request has a User-Agent"), which would
 * have broken every note fetching the GitHub API, the reference demo note
 * included, while this suite stayed green. These cases pin the headers to
 * what Node's `fetch` sent for the same call, so the port stays a port.
 */
describe('issue #10: the port preserves the headers fetch sent', () => {
  it('sends user-agent and accept on a GET, as fetch did', async () => {
    const seen: Array<http.IncomingHttpHeaders> = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers);
      res.end('{"ok":true}');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('server did not bind a port');
    }

    try {
      const provider = createNetProvider(
        ['127.0.0.1'],
        1_000_000,
        { allowRestrictedAddresses: false },
        netProviderDenial,
      );
      await provider.get(`http://127.0.0.1:${address.port}/x`);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]?.['user-agent']).toBe('node');
    expect(seen[0]?.accept).toBe('*/*');
  });

  it('sends content-type and content-length on a body-carrying request, as fetch did', async () => {
    const seen: Array<http.IncomingHttpHeaders> = [];
    const server = http.createServer((req, res) => {
      seen.push(req.headers);
      req.resume();
      res.end('{"ok":true}');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('server did not bind a port');
    }

    try {
      const provider = createNetProvider(
        ['127.0.0.1'],
        1_000_000,
        { allowRestrictedAddresses: false },
        netProviderDenial,
      );
      // `post` is optional on the provider contract; the `seen` assertions
      // below fail loudly if it was somehow absent and nothing was sent.
      await provider.post?.(`http://127.0.0.1:${address.port}/x`, '{"a":1}');
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]?.['content-type']).toBe('text/plain;charset=UTF-8');
    expect(seen[0]?.['content-length']).toBe('7');
    expect(seen[0]?.['user-agent']).toBe('node');
  });
});
