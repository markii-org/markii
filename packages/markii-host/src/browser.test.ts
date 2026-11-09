import { describe, expect, it, vi } from 'vitest';
import { createBrowserHostIsolate, createFetchNetProvider } from './browser.js';

function okFetch(body = 'hello', status = 200): typeof fetch {
  return vi.fn(async () => new Response(body, { status })) as typeof fetch;
}

describe('createFetchNetProvider', () => {
  it('denies everything with no allowlist, without calling fetch', async () => {
    const f = okFetch();
    const provider = createFetchNetProvider({ fetch: f })(
      ['api.example.com', 'evil.example.com'],
      1024,
      {},
    );
    await expect(provider.get('https://example.com/')).rejects.toThrow(
      /allowlist/,
    );
    expect(f).not.toHaveBeenCalled();
  });

  it('fetches an allowed origin and denies another', async () => {
    const f = okFetch('data');
    const provider = createFetchNetProvider({
      allowedOrigins: ['https://api.example.com', 'not a url'],
      fetch: f,
    })(['api.example.com', 'evil.example.com'], 1024, {});
    await expect(provider.get('https://api.example.com/x')).resolves.toEqual({
      status: 200,
      body: 'data',
    });
    await expect(provider.get('https://evil.example.com/x')).rejects.toThrow(
      /allowlist/,
    );
    await expect(
      provider.get('https://api.example.com:8443/x'),
    ).rejects.toThrow(/allowlist/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('denies an allowed origin whose host this run was not granted', async () => {
    const f = okFetch();
    const provider = createFetchNetProvider({
      allowedOrigins: ['https://api.example.com', 'https://other.example.com'],
      fetch: f,
    })(['other.example.com'], 1024, {});
    await expect(provider.get('https://api.example.com/x')).rejects.toThrow(
      /run's allowlist/,
    );
    expect(f).not.toHaveBeenCalled();
  });

  it('refuses credentials in the URL and non-http schemes', async () => {
    const f = okFetch();
    const provider = createFetchNetProvider({
      allowedOrigins: ['https://api.example.com'],
      fetch: f,
    })(['api.example.com', 'evil.example.com'], 1024, {});
    await expect(provider.get('https://u:p@api.example.com/')).rejects.toThrow(
      /credentials/,
    );
    await expect(provider.get('file:///etc/passwd')).rejects.toThrow(/scheme/);
    expect(f).not.toHaveBeenCalled();
  });

  it('caps the response body and refuses redirects', async () => {
    const provider = createFetchNetProvider({
      allowedOrigins: ['https://api.example.com'],
      fetch: okFetch('x'.repeat(100)),
    })(['api.example.com'], 10, {});
    await expect(provider.get('https://api.example.com/')).rejects.toThrow(
      /exceeds the 10-byte cap/,
    );
    const redirecting = createFetchNetProvider({
      allowedOrigins: ['https://api.example.com'],
      fetch: okFetch('', 302),
    })(['api.example.com'], 10, {});
    await expect(redirecting.get('https://api.example.com/')).rejects.toThrow(
      /redirects/,
    );
  });

  it('sends post bodies without credentials', async () => {
    const f = okFetch('ok');
    const provider = createFetchNetProvider({
      allowedOrigins: ['https://api.example.com'],
      fetch: f,
    })(['api.example.com', 'evil.example.com'], 1024, {});
    await provider.post?.('https://api.example.com/', 'payload');
    const init = (f as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('payload');
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('manual');
  });
});

describe('createBrowserHostIsolate', () => {
  it('is a browser isolate whose job carries the wasm URL and whose worker is a module worker', async () => {
    const created: { url: unknown; options: unknown }[] = [];
    const posted: unknown[] = [];
    class FakeWorker {
      constructor(url: unknown, options: unknown) {
        created.push({ url, options });
      }
      postMessage(message: unknown): void {
        posted.push(message);
      }
      terminate(): void {}
      addEventListener(): void {}
    }
    vi.stubGlobal('Worker', FakeWorker);
    try {
      const isolate = createBrowserHostIsolate({
        workerUrl: 'blob:worker',
        wasmUrl: new URL('https://cdn.test/glue.wasm'),
      });
      expect(isolate.kind).toBe('browser');
      const spawn = await isolate.spawner();
      const running = spawn({ entryPath: 'x', maxOldGenerationSizeMb: 1 });
      running.send({ kind: 'job' });
      expect(created).toEqual([
        { url: 'blob:worker', options: { type: 'module' } },
      ]);
      expect(posted[0]).toMatchObject({
        wasmUri: 'https://cdn.test/glue.wasm',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('starts a classic worker (no options) when asked, for an embedded IIFE bundle', async () => {
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
    try {
      const isolate = createBrowserHostIsolate({
        workerUrl: 'blob:classic',
        wasmUrl: 'blob:wasm',
        workerType: 'classic',
      });
      const spawn = await isolate.spawner();
      spawn({ entryPath: 'x', maxOldGenerationSizeMb: 1 });
      expect(created).toEqual([['blob:classic']]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
