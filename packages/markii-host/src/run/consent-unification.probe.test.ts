/**
 * Executed probe for consent unification (GitHub issue #9 follow-up,
 * SECURITY-RELEVANT): a `.mkz` bundle's consent story must match a bare
 * `.mk.md` document's exactly.
 *
 * 1. The static scan of the run's executable closure is the ONLY source of
 *    the hostnames a run prompts for — for a bundle too. A bundle
 *    manifest's `permissions.net` is declared intent only: it must never
 *    widen the prompt (a declared-but-unused host must never be prompted
 *    for or granted) and never narrow it (a host a script actually reaches
 *    must always be prompted for, declared or not).
 * 2. A mismatch between the declaration and the scan is never silently
 *    absorbed — it reaches the host's diagnostics surface as two lines,
 *    through `./bundle-run.ts`'s `netDeclarationDiagnostics`, the one
 *    function both apps' adapters read from.
 * 3. The `bundle` capability needs no user-facing prompt at all any more:
 *    a manifest's declared `permissions.bundle` grants are forwarded
 *    straight through. This does NOT loosen anything else — the path-jail
 *    (writes confined to `cache/`) and the read-only tier for
 *    auto/scheduled triggers (no writes at all) still hold, unconditionally.
 *
 * Every case here drives the REAL `runOnce` -> `runGrantFlow`/
 * `resolveStoredGrant` -> `spawnRun` pipeline end to end, through a REAL
 * `worker_thread` running the real `worker-entry.ts` and the real wasmoon
 * sandbox — same discipline as `scheduled-grant-network.probe.test.ts` and
 * `pentest-probe.test.ts`. No `GrantClosure`/`RunRequirements` object is
 * ever constructed by hand; every closure here comes from real script TEXT
 * parsed by `extractRunRequirements`'s real static analysis.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BundleManifest, BundleFsGrant } from '@markii/bundle';
import { runOnce } from './run-flow';
import type { GrantMemento, Thenable } from './grant-flow';
import { spawnRun } from './run-host';
import type { RunResult, SpawnRunOptions } from './run-host';

const WORKER_PATH = path.join(__dirname, 'worker-entry.ts');

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
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

function manifestWith(overrides: Partial<BundleManifest> = {}): BundleManifest {
  return { spec: '0.1.0', ...overrides };
}

/** The real `spawnRun`, wired to the real Node worker isolate — the same shape `runOnce`'s injected `spawnRun` expects. */
function realSpawnRun(options: SpawnRunOptions): Promise<RunResult> {
  return spawnRun({ ...options, workerPath: WORKER_PATH });
}

describe('consent unification probe — (a) the scan alone drives the prompt, never the manifest declaration', () => {
  it('prompts for exactly the host the scripts reach, never the manifest-declared host they never mention', async () => {
    const memento = fakeMemento();
    const prompted: string[] = [];

    await runOnce({
      documentKey: 'bundle:///consent-a.mkz',
      text: fence('a', 'return net.fetch_json("https://api.other.com/x")'),
      memento,
      promptHost: async (host) => {
        prompted.push(host);
        return true;
      },
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
      spawnRun: realSpawnRun,
      timeoutMs: 8000,
      bundle: {
        manifest: manifestWith({
          permissions: { net: { get: ['api.example.com'] } },
        }),
        buildSnapshot: async () => ({}),
        persistCacheOut: async () => undefined,
      },
    });

    // The prompt set is EXACTLY the scanned host. The declared-but-unused
    // manifest host is never prompted for.
    expect(prompted).toEqual(['api.other.com']);
  }, 20000);
});

describe('consent unification probe — (b) a declaration/scan mismatch surfaces as diagnostics, both directions', () => {
  it('produces both a declared-not-used and a used-not-declared line, through the real diagnostics function runOnce calls', async () => {
    const memento = fakeMemento();

    const result = await runOnce({
      documentKey: 'bundle:///consent-b.mkz',
      text: fence('a', 'return net.fetch_json("https://api.other.com/x")'),
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
      spawnRun: realSpawnRun,
      timeoutMs: 8000,
      bundle: {
        manifest: manifestWith({
          permissions: { net: { get: ['api.example.com'] } },
        }),
        buildSnapshot: async () => ({}),
        persistCacheOut: async () => undefined,
      },
    });

    expect(result.netDeclarationDiagnostics).toEqual([
      'The manifest declares net access to api.example.com. No script in this run uses that host.',
      'A script in this run uses net access to api.other.com. The manifest does not declare that host.',
    ]);
  }, 20000);
});

describe('consent unification probe — (c) the bundle capability needs no prompt, and stays path-jailed and tier-gated', () => {
  it('a manual run with declared read+write:cache/ and NO promptBundleAccess supplied still cannot write outside cache/', async () => {
    const memento = fakeMemento();

    const result = await runOnce({
      documentKey: 'bundle:///consent-c-jail.mkz',
      text: fence(
        'a',
        'local ok, err = pcall(function() bundle.write("assets/hack.txt", "pwned") end)\nreturn tostring(ok)',
      ),
      memento,
      promptHost: async () => true,
      promptUnknownHosts: async () => true,
      promptManyHosts: async () => true,
      // No promptBundleAccess field exists any more — this object type
      // does not even accept one (RunOnceOptions has no such field), which
      // is itself part of what this probe proves: the bundle capability
      // cannot be gated by a prompt because there is no prompt seam left.
      spawnRun: realSpawnRun,
      timeoutMs: 8000,
      bundle: {
        manifest: manifestWith({
          permissions: { bundle: ['read', 'write:cache/'] as BundleFsGrant[] },
        }),
        buildSnapshot: async () => ({}),
        persistCacheOut: async () => undefined,
      },
    });

    expect(result.failures).toEqual([]);
    // The write itself failed inside the pcall (caught in Lua) -- the
    // path-jail confines every write to cache/, regardless of what the
    // manifest declares or that no prompt was ever shown.
    expect(result.values.a?.value).toBe('false');
  }, 20000);

  it('the SAME declared grants under an auto trigger cannot write at all, even to cache/ — the read-only tier, not a prompt, is what blocks it', async () => {
    const memento = fakeMemento();

    const result = await runOnce({
      documentKey: 'bundle:///consent-c-tier.mkz',
      text: fence(
        'a',
        'local ok, err = pcall(function() bundle.write("cache/out.json", "{}") end)\nreturn tostring(ok)',
      ),
      trigger: 'auto',
      memento,
      promptHost: async () => {
        throw new Error('an auto trigger must never prompt');
      },
      promptUnknownHosts: async () => {
        throw new Error('an auto trigger must never prompt');
      },
      promptManyHosts: async () => {
        throw new Error('an auto trigger must never prompt');
      },
      spawnRun: realSpawnRun,
      timeoutMs: 8000,
      bundle: {
        manifest: manifestWith({
          permissions: { bundle: ['read', 'write:cache/'] as BundleFsGrant[] },
        }),
        buildSnapshot: async () => ({}),
        persistCacheOut: async () => undefined,
      },
    });

    expect(result.failures).toEqual([]);
    // Even a write INTO cache/ -- otherwise allowed -- is refused under the
    // read-only tier an auto/scheduled trigger forces, independent of the
    // manifest's declaration and of there being no prompt to decline.
    expect(result.values.a?.value).toBe('false');
  }, 20000);
});
