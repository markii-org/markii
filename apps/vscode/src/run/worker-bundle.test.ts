import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BundleManifest } from '@markii/bundle';
import { spawnRun } from './run-host';
import { withPersistedCache } from './bundle-run';

/**
 * Slice 2 of the `.mkz` Run-path arc (GitHub issue #9): real end-to-end
 * coverage of the bundle-fs capability wired into the worker
 * (`worker-entry.ts`) — spawns a REAL `worker_thread` running the real
 * wasmoon sandbox, same discipline as `run-host.test.ts`.
 */

const WORKER_PATH = path.join(__dirname, 'worker-entry.ts');

function fence(name: string, body: string, attrs = ''): string {
  const attrGroup = attrs ? ` ${attrs}` : '';
  return '```lua {name=' + name + attrGroup + '}\n' + body + '\n```\n';
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function manifestWithBundleGrants(
  grants: ('read' | 'write:cache/')[],
): BundleManifest {
  return { mark: '0.1.0', permissions: { bundle: grants } };
}

describe('worker bundle capability — read', () => {
  it('bundle.read of an asset returns its bytes when read is granted', async () => {
    const text = fence('a', 'return bundle.read("assets/photo.txt")');
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: { 'assets/photo.txt': bytesOf('hello-bytes') },
        manifest: manifestWithBundleGrants(['read']),
        grantedBundlePermissions: ['read'],
      },
    });

    expect(result.failures).toEqual([]);
    expect(result.values.a?.status).toBe('fresh');
    expect(result.values.a?.value).toBe('hello-bytes');
  });

  it('bundle.exists reports a present file and a missing one correctly', async () => {
    const text = fence(
      'a',
      'return tostring(bundle.exists("assets/there.txt")) .. "," .. tostring(bundle.exists("assets/missing.txt"))',
    );
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: { 'assets/there.txt': bytesOf('x') },
        manifest: manifestWithBundleGrants(['read']),
        grantedBundlePermissions: ['read'],
      },
    });

    expect(result.failures).toEqual([]);
    expect(result.values.a?.value).toBe('true,false');
  });

  it('bundle.read is denied when the manifest declares read but the user did not grant it (intersection)', async () => {
    const text = fence('a', 'return bundle.read("assets/photo.txt")');
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: { 'assets/photo.txt': bytesOf('secret') },
        manifest: manifestWithBundleGrants(['read']),
        // Manifest declares "read", but the user never granted it.
        grantedBundlePermissions: [],
      },
    });

    expect(result.values.a?.status).toBe('error');
    expect(result.values.a?.failureKind).toBe('capability-denied');
  });

  it('bundle.read is denied when the user granted read but the manifest never declared it (intersection, other direction)', async () => {
    const text = fence('a', 'return bundle.read("assets/photo.txt")');
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: { 'assets/photo.txt': bytesOf('secret') },
        manifest: { mark: '0.1.0' }, // declares nothing
        grantedBundlePermissions: ['read'],
      },
    });

    expect(result.values.a?.status).toBe('error');
    expect(result.values.a?.failureKind).toBe('capability-denied');
  });
});

describe('worker bundle capability — write', () => {
  it('bundle.write to cache/ succeeds and the write comes back in cacheOut', async () => {
    const text = fence(
      'a',
      'bundle.write("cache/out.json", "{\\"ok\\":true}")\nreturn "done"',
    );
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: {},
        manifest: manifestWithBundleGrants(['write:cache/']),
        grantedBundlePermissions: ['write:cache/'],
      },
    });

    expect(result.failures).toEqual([]);
    expect(result.values.a?.status).toBe('fresh');
    expect(result.cacheOut).toBeDefined();
    const written = result.cacheOut?.['cache/out.json'];
    expect(written).toBeDefined();
    expect(new TextDecoder().decode(written)).toBe('{"ok":true}');
  });

  it('bundle.write to the document or manifest is denied even when write:cache/ is granted', async () => {
    const text = fence(
      'a',
      'local ok, err = pcall(function() bundle.write("note.mk.md", "pwned") end)\nreturn tostring(ok)',
    );
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: { 'note.mk.md': bytesOf('# original') },
        manifest: manifestWithBundleGrants(['write:cache/']),
        grantedBundlePermissions: ['write:cache/'],
      },
    });

    expect(result.values.a?.status).toBe('fresh');
    // The write itself failed inside the pcall (caught in Lua), so the
    // document snapshot entry must be untouched — the whole point of the
    // unconditional document/manifest write denial.
    expect(result.cacheOut).toEqual({});
  });

  it('bundle.write outside cache/ is denied when only read is granted', async () => {
    const text = fence(
      'a',
      'local ok, err = pcall(function() bundle.write("cache/x.json", "y") end)\nreturn tostring(ok) .. ":" .. tostring(err)',
    );
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: {},
        manifest: manifestWithBundleGrants(['read']),
        grantedBundlePermissions: ['read'],
      },
    });

    expect(result.values.a?.status).toBe('fresh');
    expect(String(result.values.a?.value)).toMatch(/^false:/);
  });
});

describe('worker bundle capability — .cache/ round-trips across two runs', () => {
  it("the second run sees the first run's cache write, via the host's own persistence contract", async () => {
    // Seeded with an existing "cache/counter.json" rather than starting from
    // an empty snapshot: see this slice's report for a documented,
    // pre-existing `@markii/lua` gap — `bundle.read` of a path absent from
    // the snapshot throws a raw JS error ("Cannot read properties of null
    // (reading 'then')") instead of resolving to Lua `nil`, reproducible
    // directly against `@markii/lua`/`@markii/bundle` with no `vscode`
    // involved at all. Out of scope to fix here (`packages/markii-lua` is
    // off limits for this slice); this test is written to exercise the
    // round-trip contract this slice DOES own without tripping that
    // unrelated bug.
    const manifest = manifestWithBundleGrants(['read', 'write:cache/']);
    const bumpCounter = fence(
      'a',
      'local existing = bundle.read("cache/counter.json")\n' +
        'local n = tonumber(existing) + 1\n' +
        'bundle.write("cache/counter.json", tostring(n))\n' +
        'return n',
    );
    const seedSnapshot = () => ({
      'cache/counter.json': bytesOf('0'),
    });

    const firstRun = await spawnRun({
      text: bumpCounter,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: seedSnapshot(),
        manifest,
        grantedBundlePermissions: ['read', 'write:cache/'],
      },
    });
    expect(firstRun.failures).toEqual([]);
    expect(firstRun.values.a?.value).toBe(1);
    expect(firstRun.cacheOut).toBeDefined();

    // Host-side persistence contract (`preview-panel.ts`'s adapters, in the
    // real extension): a fresh snapshot overlaid with the PRIOR run's
    // persisted cache output — exactly `bundle-run.ts`'s `withPersistedCache`.
    const secondSnapshot = withPersistedCache(
      seedSnapshot(),
      firstRun.cacheOut ?? {},
    );

    const secondRun = await spawnRun({
      text: bumpCounter,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: secondSnapshot,
        manifest,
        grantedBundlePermissions: ['read', 'write:cache/'],
      },
    });

    expect(secondRun.failures).toEqual([]);
    expect(secondRun.values.a?.value).toBe(2);
  });
});

describe('worker bundle capability — src= resolution', () => {
  it('a src=scripts/x.lua block runs the file loaded from the snapshot', async () => {
    const text = '```lua {src=scripts/etl.lua name=stars}\n```\n';
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: { 'scripts/etl.lua': bytesOf('return 42') },
        manifest: { mark: '0.1.0' },
        grantedBundlePermissions: [],
      },
    });

    expect(result.failures).toEqual([]);
    expect(result.values.stars?.status).toBe('fresh');
    expect(result.values.stars?.value).toBe(42);
  });

  it('a src= reference to a file missing from the snapshot fails cleanly, not by throwing', async () => {
    const text = '```lua {src=scripts/missing.lua name=stars}\n```\n';
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: {},
        manifest: { mark: '0.1.0' },
        grantedBundlePermissions: [],
      },
    });

    expect(result.values.stars?.status).toBe('error');
  });
});

describe('worker bundle capability — no bundle field', () => {
  it('a bare .mk.md run (no job.bundle) never exposes a bundle table at all', async () => {
    const text = fence('a', 'return tostring(bundle)');
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
    });

    expect(result.values.a?.status).toBe('fresh');
    expect(result.values.a?.value).toBe('nil');
    expect(result.cacheOut).toBeUndefined();
  });
});

describe('worker pack module require (GitHub issue #3 slice 5)', () => {
  it('require "packName/modulePath" resolves from a pre-loaded packModules map', async () => {
    const text = fence('a', 'local m = require "demo/http"\nreturn m.ok');
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      packModules: { demo: { 'http.lua': 'return { ok = true }' } },
    });

    expect(result.failures).toEqual([]);
    expect(result.values.a?.status).toBe('fresh');
    expect(result.values.a?.value).toBe(true);
  });

  it('require for a pack namespace absent from the loaded map fails as an ordinary "no such module" error, not a denial', async () => {
    // A resolver IS configured (packModules has an entry for "demo"), so
    // this is a genuine miss — same treatment @markii/lua's require.ts
    // gives any other missing module — never a capability denial, which is
    // reserved for "no resolver at all" (the next test).
    const text = fence('a', 'return require "nope/anything"');
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      packModules: { demo: { 'http.lua': 'return {}' } },
    });

    expect(result.values.a?.status).toBe('error');
    expect(result.values.a?.failureKind).toBe('script-error');
  });

  it('a bare run with no packModules denies a pack-namespaced require cleanly', async () => {
    const text = fence('a', 'return require "demo/http"');
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
    });

    expect(result.values.a?.status).toBe('error');
    expect(result.values.a?.failureKind).toBe('capability-denied');
  });
});
