import { describe, expect, it } from 'vitest';
import type { RunResult } from '../run/run-host.js';
import { readLastRunTrace } from '../run/run-trace.js';
import type { GrantMemento, Thenable } from '../run/grant-flow.js';
import { BROWSER_ISOLATE_ENTRY } from './adapter.js';
import type { HostAdapter, HostPromptRequest } from './adapter.js';
import { CLI_LABELS } from './labels.js';
import {
  promptsFromAdapter,
  runViaAdapter,
  spawnRunViaAdapter,
} from './run-behavior.js';

/** A plain in-memory `GrantMemento`, the same minimal shape every real adapter's device-local store satisfies. */
function createMemoryMemento(): GrantMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return store.has(key) ? (store.get(key) as T) : (defaultValue as T);
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

function fakeAdapter(overrides: Partial<HostAdapter> = {}): HostAdapter {
  return {
    id: 'cli',
    labels: CLI_LABELS,
    readFile: async () => new Uint8Array(),
    exists: async () => false,
    writeFile: async () => {},
    listFolder: async () => [],
    prompt: async () => false,
    memento: createMemoryMemento(),
    diagnostics: () => {},
    now: () => 1_000,
    ...overrides,
  };
}

describe('promptsFromAdapter', () => {
  it('routes all three grant prompts through adapter.prompt with the exact shared wording', async () => {
    const seen: HostPromptRequest[] = [];
    const adapter = fakeAdapter({
      prompt: async (request) => {
        seen.push(request);
        return true;
      },
    });
    const prompts = promptsFromAdapter(adapter);

    await prompts.promptHost('api.example.com', []);
    await prompts.promptUnknownHosts();
    await prompts.promptManyHosts(20);

    expect(seen.map((r) => r.kind)).toEqual([
      'grant-host',
      'grant-unknown-hosts',
      'grant-many-hosts',
    ]);
    expect(seen[0]?.message).toContain('api.example.com');
    expect(seen.every((r) => r.consequential)).toBe(true);
    expect(seen.every((r) => r.allowLabel === 'Allow')).toBe(true);
    expect(seen.every((r) => r.denyLabel === "Don't allow")).toBe(true);
  });

  it('resolves false when adapter.prompt denies', async () => {
    const adapter = fakeAdapter({ prompt: async () => false });
    const prompts = promptsFromAdapter(adapter);
    expect(await prompts.promptHost('host', [])).toBe(false);
    expect(await prompts.promptUnknownHosts()).toBe(false);
    expect(await prompts.promptManyHosts(11)).toBe(false);
  });
});

describe('spawnRunViaAdapter', () => {
  const cacheSnapshot = {};

  it('reports a clean capability-denied failure, never a throw, when the adapter has no isolate', async () => {
    const result = await spawnRunViaAdapter(undefined, {
      text: '',
      netAllowlist: [],
      cacheSnapshot,
      timeoutMs: 1000,
    });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.kind).toBe('capability-denied');
    expect(result.values).toEqual({});
  });

  it('calls the node isolate workerPath and forwards it to spawnRun', async () => {
    // Uses a hostile workerPath that does not exist; the real spawnRun's
    // own worker-spawn failure is caught as an ordinary RunResult failure
    // rather than a throw, which is enough to prove the path was reached
    // without needing a real worker thread in this unit test.
    const isolate = {
      kind: 'node' as const,
      workerPath: () => '/nonexistent/worker.js',
    };
    const result = await spawnRunViaAdapter(isolate, {
      text: '',
      netAllowlist: [],
      cacheSnapshot,
      timeoutMs: 1000,
    });
    expect(result.cacheSnapshot).toBe(cacheSnapshot);
  });

  it('spawns and disposes a browser isolate exactly once per call', async () => {
    let disposed = 0;
    let spawnerCalls = 0;
    const fakeResult: RunResult = { values: {}, failures: [], cacheSnapshot };
    const isolate = {
      kind: 'browser' as const,
      spawner: async () => {
        spawnerCalls += 1;
        return () => ({
          send: () => {},
          kill: () => {},
          onMessage: (listener: (message: unknown) => void) => {
            listener(fakeResult);
          },
          onError: () => {},
          onExit: () => {},
        });
      },
      dispose: () => {
        disposed += 1;
      },
    };
    const result = await spawnRunViaAdapter(isolate, {
      text: '',
      netAllowlist: [],
      cacheSnapshot,
      timeoutMs: 1000,
    });
    expect(spawnerCalls).toBe(1);
    expect(disposed).toBe(1);
    expect(result).toEqual(fakeResult);
  });

  // Regression: the browser branch used to call spawnRun with no
  // workerPath at all, which reached spawnRun's dev-only fallback. That
  // fallback throws in a packaged host, so a released Obsidian plugin
  // could not run a script even though every unit test passed. The entry
  // is a LABEL for a blob-URL worker, never a path that gets opened.
  it('labels the entry for a browser isolate instead of reaching the dev-only worker path fallback', async () => {
    const fakeResult: RunResult = { values: {}, failures: [], cacheSnapshot };
    const seen: string[] = [];
    const makeIsolate = (entryLabel?: string) => ({
      kind: 'browser' as const,
      spawner: async () => (options: { entryPath: string }) => {
        seen.push(options.entryPath);
        return {
          send: () => {},
          kill: () => {},
          onMessage: (listener: (message: unknown) => void) => {
            listener(fakeResult);
          },
          onError: () => {},
          onExit: () => {},
        };
      },
      dispose: () => {},
      ...(entryLabel === undefined ? {} : { entryLabel }),
    });

    await spawnRunViaAdapter(makeIsolate(), {
      text: '',
      netAllowlist: [],
      cacheSnapshot,
      timeoutMs: 1000,
    });
    await spawnRunViaAdapter(makeIsolate('markii:custom-worker'), {
      text: '',
      netAllowlist: [],
      cacheSnapshot,
      timeoutMs: 1000,
    });

    expect(seen).toEqual([BROWSER_ISOLATE_ENTRY, 'markii:custom-worker']);
  });
});

describe('runViaAdapter', () => {
  it('runs a script-free note end to end and writes the RunTrace using adapter.now()', async () => {
    const fakeResult: RunResult = {
      values: {},
      failures: [],
      cacheSnapshot: {},
    };
    const adapter = fakeAdapter({ now: () => 42_000 });

    const result = await runViaAdapter(
      adapter,
      {
        documentKey: 'doc-1',
        text: 'plain text, no scripts',
        trigger: 'manual',
      },
      async () => fakeResult,
    );

    expect(result.values).toEqual({});
    expect(result.failures).toEqual([]);

    const trace = readLastRunTrace(adapter.memento, 'doc-1');
    expect(trace).toEqual({ trigger: 'manual', ranAt: 42_000, ok: true });
  });

  it('records a failing RunTrace with a reason when the run reports failures', async () => {
    const fakeResult: RunResult = {
      values: {},
      failures: [{ name: 's1', message: 'boom', kind: 'script-error' }],
      cacheSnapshot: {},
    };
    const adapter = fakeAdapter({ now: () => 5 });

    await runViaAdapter(
      adapter,
      { documentKey: 'doc-2', text: 'text', trigger: 'auto' },
      async () => fakeResult,
    );

    const trace = readLastRunTrace(adapter.memento, 'doc-2');
    expect(trace?.ok).toBe(false);
    expect(trace?.reason).toBe('1 script failed');
  });

  it('never prompts for an auto/scheduled trigger, since runOnce resolves grants non-interactively for those', async () => {
    let prompted = false;
    const adapter = fakeAdapter({
      prompt: async () => ((prompted = true), true),
    });
    const fakeResult: RunResult = {
      values: {},
      failures: [],
      cacheSnapshot: {},
    };

    await runViaAdapter(
      adapter,
      {
        documentKey: 'doc-3',
        text: '```lua name=x permissions="net:https://api.example.com"\nnet.fetch_json("https://api.example.com")\n```',
        trigger: 'auto',
      },
      async () => fakeResult,
    );

    expect(prompted).toBe(false);
  });
});
