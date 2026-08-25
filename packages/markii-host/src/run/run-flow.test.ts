import { describe, expect, it, vi } from 'vitest';
import type { BundleManifest } from '@markii/bundle';
import type { GrantMemento, Thenable } from './grant-flow';
import type { RunResult, SpawnRunOptions } from './run-host';
import {
  MAX_CACHE_SNAPSHOT_BYTES,
  cacheStorageKeyFor,
  isCacheSnapshotShape,
  mergePersistedValues,
  readPersistedValues,
  runOnce,
  serializeCacheSnapshotIfSmallEnough,
  valuesStorageKeyFor,
} from './run-flow';
import { runGrantFlow } from './grant-flow';

function fence(name: string, body: string): string {
  return '```lua {name=' + name + '}\n' + body + '\n```\n';
}

function fakeMemento(initial: Record<string, unknown> = {}): GrantMemento {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) : defaultValue) as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
      return Promise.resolve();
    },
  };
}

function fakeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    values: { a: { value: 2, status: 'fresh' } },
    failures: [],
    cacheSnapshot: {},
    ...overrides,
  };
}

describe('runOnce', () => {
  it('runs the grant flow, spawns with the resulting allowlist, and reshapes the result', async () => {
    const memento = fakeMemento();
    const spawnRun = vi.fn((_options: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(fakeRunResult()),
    );

    const result = await runOnce({
      documentKey: 'file:///a.mk.md',
      text: fence('a', 'return net.fetch_json("https://api.example.com/x")'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });

    expect(spawnRun).toHaveBeenCalledTimes(1);
    const spawnArgs = spawnRun.mock.calls[0]?.[0];
    expect(spawnArgs?.netAllowlist).toEqual(['api.example.com']);
    expect(spawnArgs?.timeoutMs).toBe(15000);
    expect(result.values.a?.value).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it('reduces RunFailure entries to {name, kind} only -- never the raw message', async () => {
    const memento = fakeMemento();
    const spawnRun = () =>
      Promise.resolve(
        fakeRunResult({
          failures: [
            {
              name: 'a',
              message: 'some internal detail',
              kind: 'script-error',
            },
          ],
        }),
      );

    const result = await runOnce({
      documentKey: 'file:///a.mk.md',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });

    expect(result.failures).toEqual([{ name: 'a', kind: 'script-error' }]);
  });

  it("D-1: strips a stored value's raw error text before returning it, keeping failureKind", async () => {
    const memento = fakeMemento();
    const spawnRun = () =>
      Promise.resolve(
        fakeRunResult({
          values: {
            a: {
              value: undefined,
              status: 'error',
              error:
                'net provider: redirected to disallowed host "evil.example.com" (https://api.example.com/x -> https://evil.example.com/y)',
              failureKind: 'capability-denied',
            },
            b: { value: 42, status: 'fresh' },
          },
        }),
      );

    const result = await runOnce({
      documentKey: 'file:///a.mk.md',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });

    expect(result.values.a).toEqual({
      value: undefined,
      status: 'error',
      failureKind: 'capability-denied',
    });
    expect(result.values.a?.error).toBeUndefined();
    // A value that never failed is untouched.
    expect(result.values.b).toEqual({ value: 42, status: 'fresh' });
  });

  it('seeds the run from a previously persisted cache snapshot for the same document', async () => {
    const documentKey = 'file:///a.mk.md';
    const memento = fakeMemento({
      [cacheStorageKeyFor(documentKey)]: {
        k: { value: 'cached', storedAtMs: 0 },
      },
    });
    const spawnRun = vi.fn((_options: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(fakeRunResult()),
    );

    await runOnce({
      documentKey,
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });

    expect(spawnRun.mock.calls[0]?.[0].cacheSnapshot).toEqual({
      k: { value: 'cached', storedAtMs: 0 },
    });
  });

  it('persists the returned cache snapshot for the next run', async () => {
    const documentKey = 'file:///a.mk.md';
    const memento = fakeMemento();
    const spawnRun = () =>
      Promise.resolve(
        fakeRunResult({ cacheSnapshot: { k: { value: 'x', storedAtMs: 0 } } }),
      );

    await runOnce({
      documentKey,
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });

    expect(memento.get(cacheStorageKeyFor(documentKey))).toEqual({
      k: { value: 'x', storedAtMs: 0 },
    });
  });

  it('drops (never partially writes) a cache snapshot over the size cap', async () => {
    const documentKey = 'file:///a.mk.md';
    const memento = fakeMemento({
      [cacheStorageKeyFor(documentKey)]: { existing: true },
    });
    const huge = {
      blob: { value: 'x'.repeat(MAX_CACHE_SNAPSHOT_BYTES + 1), storedAtMs: 0 },
    };
    const spawnRun = () =>
      Promise.resolve(fakeRunResult({ cacheSnapshot: huge }));

    await runOnce({
      documentKey,
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });

    expect(memento.get(cacheStorageKeyFor(documentKey))).toBeUndefined();
  });

  it('a foreign/corrupt stored cache value degrades to an empty seed rather than throwing', async () => {
    const documentKey = 'file:///a.mk.md';
    const memento = fakeMemento({
      [cacheStorageKeyFor(documentKey)]: 'not-an-object',
    });
    const spawnRun = vi.fn((_options: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(fakeRunResult()),
    );

    await runOnce({
      documentKey,
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });

    expect(spawnRun.mock.calls[0]?.[0].cacheSnapshot).toEqual({});
  });
});

function manifestWith(overrides: Partial<BundleManifest> = {}): BundleManifest {
  return { mark: '0.1.0', ...overrides };
}

describe('runOnce — bundle-backed run', () => {
  it('merges the manifest-declared net hosts into the grant flow (union with the static scan)', async () => {
    const memento = fakeMemento();
    const spawnRun = vi.fn((_options: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(fakeRunResult()),
    );

    const result = await runOnce({
      documentKey: 'bundle:///a.mkz',
      // The static scan alone would only find "scan.example.com".
      text: fence('a', 'return net.fetch_json("https://scan.example.com/x")'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
      bundle: {
        manifest: manifestWith({
          permissions: { net: { get: ['manifest.example.com'] } },
        }),
        buildSnapshot: () => Promise.resolve({}),
        persistCacheOut: () => Promise.resolve(),
      },
    });

    expect(result.failures).toEqual([]);
    const spawnArgs = spawnRun.mock.calls[0]?.[0];
    expect(spawnArgs?.netAllowlist.sort()).toEqual(
      ['manifest.example.com', 'scan.example.com'].sort(),
    );
  });

  it('prompts for the manifest-declared bundle-fs grants and forwards the allowed subset to spawnRun', async () => {
    const memento = fakeMemento();
    const spawnRun = vi.fn((_options: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(fakeRunResult()),
    );
    const promptBundleAccess = vi.fn(() => Promise.resolve(true));

    await runOnce({
      documentKey: 'bundle:///a.mkz',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      promptBundleAccess,
      spawnRun,
      timeoutMs: 15000,
      bundle: {
        manifest: manifestWith({
          permissions: { bundle: ['read', 'write:cache/'] },
        }),
        buildSnapshot: () =>
          Promise.resolve({ 'assets/x.txt': new Uint8Array([1]) }),
        persistCacheOut: () => Promise.resolve(),
      },
    });

    expect(promptBundleAccess).toHaveBeenCalledWith(['read', 'write:cache/']);
    const spawnArgs = spawnRun.mock.calls[0]?.[0];
    expect(spawnArgs?.bundle?.grantedBundlePermissions).toEqual([
      'read',
      'write:cache/',
    ]);
    expect(spawnArgs?.bundle?.snapshot).toEqual({
      'assets/x.txt': new Uint8Array([1]),
    });
  });

  it('declining the bundle-access prompt forwards no bundle-fs grants at all', async () => {
    const memento = fakeMemento();
    const spawnRun = vi.fn((_options: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(fakeRunResult()),
    );

    await runOnce({
      documentKey: 'bundle:///a.mkz',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      promptBundleAccess: () => Promise.resolve(false),
      spawnRun,
      timeoutMs: 15000,
      bundle: {
        manifest: manifestWith({ permissions: { bundle: ['read'] } }),
        buildSnapshot: () => Promise.resolve({}),
        persistCacheOut: () => Promise.resolve(),
      },
    });

    const spawnArgs = spawnRun.mock.calls[0]?.[0];
    expect(spawnArgs?.bundle?.grantedBundlePermissions).toEqual([]);
  });

  it('persists RunResult.cacheOut via the bundle option when present', async () => {
    const memento = fakeMemento();
    const cacheOut = { 'cache/a.json': new Uint8Array([1, 2, 3]) };
    const spawnRun = () => Promise.resolve(fakeRunResult({ cacheOut }));
    const persistCacheOut = vi.fn(() => Promise.resolve());

    await runOnce({
      documentKey: 'bundle:///a.mkz',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
      bundle: {
        manifest: manifestWith(),
        buildSnapshot: () => Promise.resolve({}),
        persistCacheOut,
      },
    });

    expect(persistCacheOut).toHaveBeenCalledWith(cacheOut);
  });

  it('never persists cacheOut when the run produced none', async () => {
    const memento = fakeMemento();
    const spawnRun = () => Promise.resolve(fakeRunResult());
    const persistCacheOut = vi.fn(() => Promise.resolve());

    await runOnce({
      documentKey: 'bundle:///a.mkz',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
      bundle: {
        manifest: manifestWith(),
        buildSnapshot: () => Promise.resolve({}),
        persistCacheOut,
      },
    });

    expect(persistCacheOut).not.toHaveBeenCalled();
  });

  it("F-1: swapping a src= script file's content (note text unchanged) re-prompts on the next run", async () => {
    const memento = fakeMemento();
    const text = '```lua {name=a src=scripts/etl.lua}\n```\n';
    const promptHost = vi.fn(() => Promise.resolve(true));
    const spawnRun = () => Promise.resolve(fakeRunResult());

    const runWith = (etlSource: string) =>
      runOnce({
        documentKey: 'bundle:///same.mkz',
        text,
        memento,
        promptHost,
        promptUnknownHosts: () => Promise.resolve(true),
        promptManyHosts: () => Promise.resolve(true),
        spawnRun,
        timeoutMs: 15000,
        bundle: {
          manifest: manifestWith({
            permissions: { net: { get: ['api.example.com'] } },
          }),
          buildSnapshot: () =>
            Promise.resolve({
              'scripts/etl.lua': new TextEncoder().encode(etlSource),
            }),
          persistCacheOut: () => Promise.resolve(),
        },
      });

    await runWith('return 1');
    expect(promptHost).toHaveBeenCalledTimes(1);

    // Same note text, same script fence -- but the referenced file's
    // content changed. Before the F-1 fix, `bundleModules` was always `{}`
    // in the grant closure, so this would NOT re-prompt.
    await runWith('return 2');
    expect(promptHost).toHaveBeenCalledTimes(2);

    // Re-running with the SAME (already-seen) content reuses the grant.
    await runWith('return 2');
    expect(promptHost).toHaveBeenCalledTimes(2);
  });

  it('F-1: two otherwise-identical bundles differing only in a src= script body get different grant keys', async () => {
    const text = '```lua {name=a src=scripts/etl.lua}\n```\n';
    const promptHostA = vi.fn(() => Promise.resolve(true));
    const promptHostB = vi.fn(() => Promise.resolve(true));

    const run = (
      documentKey: string,
      promptHost: typeof promptHostA,
      etlSource: string,
    ) =>
      runOnce({
        documentKey,
        text,
        memento: fakeMemento(),
        promptHost,
        promptUnknownHosts: () => Promise.resolve(true),
        promptManyHosts: () => Promise.resolve(true),
        spawnRun: () => Promise.resolve(fakeRunResult()),
        timeoutMs: 15000,
        bundle: {
          manifest: manifestWith({
            permissions: { net: { get: ['api.example.com'] } },
          }),
          buildSnapshot: () =>
            Promise.resolve({
              'scripts/etl.lua': new TextEncoder().encode(etlSource),
            }),
          persistCacheOut: () => Promise.resolve(),
        },
      });

    // Independent documents (independent Mementos), so this only exercises
    // that both runs prompt fresh -- the real assertion of "different key"
    // lives in `grant-flow.test.ts`'s direct `computeGrantKey`-level
    // coverage; this is the end-to-end wiring check that `runOnce` actually
    // resolves and threads the src= content through at all, for both
    // bundles, without throwing.
    await run('bundle:///x.mkz', promptHostA, 'return 1');
    await run('bundle:///y.mkz', promptHostB, 'return 2');
    expect(promptHostA).toHaveBeenCalledTimes(1);
    expect(promptHostB).toHaveBeenCalledTimes(1);
  });

  it('F-1: a src= reference to a file missing from the bundle snapshot degrades gracefully, never throwing', async () => {
    const memento = fakeMemento();
    const text = '```lua {name=a src=scripts/missing.lua}\n```\n';

    await expect(
      runOnce({
        documentKey: 'bundle:///missing-src.mkz',
        text,
        memento,
        promptHost: () => Promise.resolve(true),
        promptUnknownHosts: () => Promise.resolve(true),
        promptManyHosts: () => Promise.resolve(true),
        spawnRun: () => Promise.resolve(fakeRunResult()),
        timeoutMs: 15000,
        bundle: {
          manifest: manifestWith(),
          // The snapshot never includes scripts/missing.lua at all.
          buildSnapshot: () => Promise.resolve({}),
          persistCacheOut: () => Promise.resolve(),
        },
      }),
    ).resolves.toBeDefined();
  });

  it('a bare .mk.md run (no bundle option) never calls buildSnapshot or sends a bundle field to spawnRun', async () => {
    const memento = fakeMemento();
    const spawnRun = vi.fn((_options: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(fakeRunResult()),
    );

    await runOnce({
      documentKey: 'file:///a.mk.md',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });

    const spawnArgs = spawnRun.mock.calls[0]?.[0];
    expect(spawnArgs?.bundle).toBeUndefined();
  });
});

describe('isCacheSnapshotShape', () => {
  it('accepts a plain object, rejects arrays/null/primitives', () => {
    expect(isCacheSnapshotShape({})).toBe(true);
    expect(isCacheSnapshotShape([])).toBe(false);
    expect(isCacheSnapshotShape(null)).toBe(false);
    expect(isCacheSnapshotShape('x')).toBe(false);
    expect(isCacheSnapshotShape(42)).toBe(false);
  });
});

describe('serializeCacheSnapshotIfSmallEnough', () => {
  it('returns the JSON text for a small snapshot', () => {
    expect(serializeCacheSnapshotIfSmallEnough({ a: 1 })).toBe('{"a":1}');
  });

  it('returns undefined for a snapshot beyond the size cap', () => {
    const huge = { blob: 'x'.repeat(MAX_CACHE_SNAPSHOT_BYTES + 1) };
    expect(serializeCacheSnapshotIfSmallEnough(huge)).toBeUndefined();
  });

  it('returns undefined for a value JSON.stringify cannot handle', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(serializeCacheSnapshotIfSmallEnough(circular)).toBeUndefined();
  });
});

describe('runOnce packModules forwarding', () => {
  it('forwards packModules to spawnRun verbatim when present', async () => {
    const memento = fakeMemento();
    const spawnRun = vi.fn((_options: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(fakeRunResult()),
    );
    const packModules = { demo: { 'http.lua': 'return {}' } };

    await runOnce({
      documentKey: 'file:///a.mk.md',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
      packModules,
    });

    expect(spawnRun.mock.calls[0]?.[0]?.packModules).toEqual(packModules);
  });

  it('omits packModules from the spawnRun call when not configured', async () => {
    const memento = fakeMemento();
    const spawnRun = vi.fn((_options: SpawnRunOptions): Promise<RunResult> =>
      Promise.resolve(fakeRunResult()),
    );

    await runOnce({
      documentKey: 'file:///a.mk.md',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });

    expect(spawnRun.mock.calls[0]?.[0]).not.toHaveProperty('packModules');
  });
});

describe('runOnce — trigger tiers (issue #11)', () => {
  it('forwards trigger to spawnRun (manual by default)', async () => {
    const memento = fakeMemento();
    const spawnRun = vi.fn((_o: SpawnRunOptions) =>
      Promise.resolve(fakeRunResult()),
    );
    await runOnce({
      documentKey: 'file:///a.mk.md',
      text: fence('a', 'return 1'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });
    expect(spawnRun.mock.calls[0]?.[0]?.trigger).toBe('manual');
  });

  it('an auto/scheduled run never prompts, even for an ungranted host', async () => {
    const memento = fakeMemento();
    const promptHost = vi.fn(() => Promise.resolve(true));
    const spawnRun = vi.fn((_o: SpawnRunOptions) =>
      Promise.resolve(fakeRunResult()),
    );
    const out = await runOnce({
      documentKey: 'file:///a.mk.md',
      text: fence('a', 'return net.fetch_json("https://api.example.com/x")'),
      trigger: 'scheduled',
      memento,
      promptHost,
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });
    expect(promptHost).not.toHaveBeenCalled();
    // No stored grant -> empty allowlist, and trigger forwarded.
    expect(spawnRun.mock.calls[0]?.[0]?.netAllowlist).toEqual([]);
    expect(spawnRun.mock.calls[0]?.[0]?.trigger).toBe('scheduled');
    expect(out.values.a?.value).toBe(2);
  });

  it('an auto run reuses a grant a prior manual run persisted, with no prompt', async () => {
    const memento = fakeMemento();
    const documentKey = 'file:///a.mk.md';
    const text = fence(
      'a',
      'return net.fetch_json("https://api.example.com/x")',
    );
    // Seed a grant the manual way (through the same requirements runOnce derives).
    const { extractRunRequirements } = await import('./script-requirements');
    await runGrantFlow({
      documentKey,
      requirements: extractRunRequirements(text),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
    });

    const promptHost = vi.fn(() => Promise.resolve(true));
    const spawnRun = vi.fn((_o: SpawnRunOptions) =>
      Promise.resolve(fakeRunResult()),
    );
    await runOnce({
      documentKey,
      text,
      trigger: 'auto',
      memento,
      promptHost,
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });
    expect(promptHost).not.toHaveBeenCalled();
    expect(spawnRun.mock.calls[0]?.[0]?.netAllowlist).toEqual([
      'api.example.com',
    ]);
  });
});

describe('runOnce — value persistence (issue #11, gap 1)', () => {
  it('persists the run value store under the values key', async () => {
    const memento = fakeMemento();
    const spawnRun = () =>
      Promise.resolve(
        fakeRunResult({ values: { a: { value: 42, status: 'fresh' } } }),
      );
    await runOnce({
      documentKey: 'file:///a.mk.md',
      text: fence('a', 'return 42'),
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });
    const persisted = readPersistedValues(memento, 'file:///a.mk.md');
    expect(persisted.a?.value).toBe(42);
    expect(memento.get(valuesStorageKeyFor('file:///a.mk.md'))).toBeDefined();
  });

  it('a failed run keeps the prior good value (last-known-good), marked stale', async () => {
    const documentKey = 'file:///a.mk.md';
    const memento = fakeMemento({
      [valuesStorageKeyFor(documentKey)]: { a: { value: 7, status: 'fresh' } },
    });
    const spawnRun = () =>
      Promise.resolve(
        fakeRunResult({
          values: {
            a: {
              value: undefined,
              status: 'error',
              failureKind: 'capability-denied',
            },
          },
        }),
      );
    await runOnce({
      documentKey,
      text: fence('a', 'return net.fetch_json("https://api.example.com/x")'),
      trigger: 'scheduled',
      memento,
      promptHost: () => Promise.resolve(true),
      promptUnknownHosts: () => Promise.resolve(true),
      promptManyHosts: () => Promise.resolve(true),
      spawnRun,
      timeoutMs: 15000,
    });
    const persisted = readPersistedValues(memento, documentKey);
    expect(persisted.a?.value).toBe(7);
    expect(persisted.a?.status).toBe('stale');
  });
});

describe('mergePersistedValues', () => {
  it('a fresh value always wins', () => {
    const merged = mergePersistedValues(
      { a: { value: 1, status: 'fresh' } },
      { a: { value: 2, status: 'fresh' } },
    );
    expect(merged.a?.value).toBe(2);
  });

  it('an error keeps the prior good value, marked stale', () => {
    const merged = mergePersistedValues(
      { a: { value: 1, status: 'fresh' } },
      { a: { value: undefined, status: 'error', failureKind: 'script-error' } },
    );
    expect(merged.a).toEqual({ value: 1, status: 'stale' });
  });

  it('an error with no prior value surfaces the error', () => {
    const merged = mergePersistedValues(
      {},
      { a: { value: undefined, status: 'error', failureKind: 'script-error' } },
    );
    expect(merged.a?.status).toBe('error');
  });

  it('drops names only in the prior store', () => {
    const merged = mergePersistedValues(
      { gone: { value: 1, status: 'fresh' } },
      { a: { value: 2, status: 'fresh' } },
    );
    expect(Object.keys(merged)).toEqual(['a']);
  });
});
