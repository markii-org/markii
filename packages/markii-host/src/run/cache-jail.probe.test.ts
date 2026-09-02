import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BundleManifest } from '@markii/bundle';
import { spawnRun } from './run-host';

/**
 * Executed probe for issue #39: `.cache/` is the one writable directory,
 * everywhere, including through the worker's real bundle-fs capability.
 * Runs a real `worker_thread` running the real wasmoon sandbox (same
 * discipline as `worker-bundle.test.ts`) — never a mock of `bundle.write`
 * or of the path-jail.
 */

const WORKER_PATH = path.join(__dirname, 'worker-entry.ts');

function fence(name: string, body: string): string {
  return '```lua {name=' + name + '}\n' + body + '\n```\n';
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function manifestWithCacheWrite(): BundleManifest {
  return { spec: '0.1.0', permissions: { bundle: ['read', 'write:.cache/'] } };
}

async function attemptWrite(targetPath: string) {
  const text = fence(
    'a',
    `local ok, err = pcall(function() bundle.write(${JSON.stringify(targetPath)}, "x") end)\nreturn tostring(ok)`,
  );
  return spawnRun({
    text,
    netAllowlist: [],
    cacheSnapshot: {},
    timeoutMs: 5000,
    workerPath: WORKER_PATH,
    bundle: {
      snapshot: { 'note.mk.md': bytesOf('# original') },
      manifest: manifestWithCacheWrite(),
      grantedBundlePermissions: ['read', 'write:.cache/'],
    },
  });
}

describe('cache-jail probe: `.cache/` is the one writable directory (issue #39)', () => {
  it('writing ".cache/x.json" succeeds with the write:.cache/ grant, and reading it back returns the bytes', async () => {
    const text = fence(
      'a',
      'bundle.write(".cache/x.json", "{\\"ok\\":true}")\nreturn bundle.read(".cache/x.json")',
    );
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
      bundle: {
        snapshot: {},
        manifest: manifestWithCacheWrite(),
        grantedBundlePermissions: ['read', 'write:.cache/'],
      },
    });

    expect(result.failures).toEqual([]);
    expect(result.values.a?.status).toBe('fresh');
    expect(result.values.a?.value).toBe('{"ok":true}');
    expect(result.cacheOut).toBeDefined();
    const written = result.cacheOut?.['.cache/x.json'];
    expect(written).toBeDefined();
    expect(new TextDecoder().decode(written)).toBe('{"ok":true}');
  });

  it('writing "cache/x" (the retired undotted spelling) is denied even with the write:.cache/ grant', async () => {
    const result = await attemptWrite('cache/x');
    expect(result.values.a?.status).toBe('fresh');
    expect(result.values.a?.value).toBe('false');
    expect(result.cacheOut).toEqual({});
  });

  it('writing "../.cache/x" is denied (path-jail, not just the prefix check)', async () => {
    const result = await attemptWrite('../.cache/x');
    expect(result.values.a?.status).toBe('fresh');
    expect(result.values.a?.value).toBe('false');
    expect(result.cacheOut).toEqual({});
  });

  it('writing ".cache/../manifest.json" is denied (normalizes to a manifest write, unconditionally refused)', async () => {
    const result = await attemptWrite('.cache/../manifest.json');
    expect(result.values.a?.status).toBe('fresh');
    expect(result.values.a?.value).toBe('false');
    expect(result.cacheOut).toEqual({});
  });

  it('writing ".cache" itself (no trailing segment) is denied', async () => {
    const result = await attemptWrite('.cache');
    expect(result.values.a?.status).toBe('fresh');
    expect(result.values.a?.value).toBe('false');
    expect(result.cacheOut).toEqual({});
  });

  it('"note.mk.md" and "manifest.json" remain denied even with the write:.cache/ grant', async () => {
    const noteResult = await attemptWrite('note.mk.md');
    expect(noteResult.values.a?.status).toBe('fresh');
    expect(noteResult.values.a?.value).toBe('false');
    expect(noteResult.cacheOut).toEqual({});

    const manifestResult = await attemptWrite('manifest.json');
    expect(manifestResult.values.a?.status).toBe('fresh');
    expect(manifestResult.values.a?.value).toBe('false');
    expect(manifestResult.cacheOut).toEqual({});
  });
});
