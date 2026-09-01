import type { ScriptBlock } from '@markii/core';
import { describe, expect, it } from 'vitest';
import { createValueStore } from './store';
import { createVaultStore } from './vault';
import type { VaultWriter } from './vault';
import {
  runDocumentScripts,
  tierForTrigger,
  type ExecuteResult,
  type ExecutionTier,
  type RunTrigger,
  type ScriptExecutor,
} from './run';

function block(
  overrides: Partial<ScriptBlock> & { name: string },
): ScriptBlock {
  return { lang: 'lua', code: 'return 1', ...overrides };
}

describe('tierForTrigger', () => {
  it("maps 'manual' to the 'manual' tier", () => {
    expect(tierForTrigger('manual')).toBe('manual');
  });

  it("maps 'auto' to the read-only 'auto' tier", () => {
    expect(tierForTrigger('auto')).toBe('auto');
  });

  it("maps 'scheduled' to the read-only 'auto' tier", () => {
    expect(tierForTrigger('scheduled')).toBe('auto');
  });

  it("exhaustively: only 'manual' ever yields the 'manual' tier — 'auto' and 'scheduled' can never reach it", () => {
    const triggers: RunTrigger[] = ['manual', 'auto', 'scheduled'];
    for (const trigger of triggers) {
      const tier = tierForTrigger(trigger);
      if (trigger === 'manual') {
        expect(tier).toBe('manual');
      } else {
        expect(tier).toBe('auto');
        expect(tier).not.toBe('manual');
      }
    }
  });
});

describe('runDocumentScripts', () => {
  it('writes a fresh value into the store for a successful script', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () => ({ ok: true, value: 42 });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'stars' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('stars')).toMatchObject({ value: 42, status: 'fresh' });
    expect(summary.results).toEqual([{ name: 'stars', status: 'fresh' }]);
    expect(summary.freshCount).toBe(1);
    expect(summary.errorCount).toBe(0);
  });

  it('records an error status for a failing script and continues the batch', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async ({ code }) => {
      if (code === 'boom') {
        return {
          ok: false,
          error: { kind: 'script-error', message: 'kaboom' },
        };
      }
      return { ok: true, value: code };
    };

    const summary = await runDocumentScripts({
      scripts: [
        block({ name: 'a', code: 'ok-a' }),
        block({ name: 'b', code: 'boom' }),
        block({ name: 'c', code: 'ok-c' }),
      ],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('a')).toMatchObject({ value: 'ok-a', status: 'fresh' });
    expect(store.get('b')).toMatchObject({ status: 'error', error: 'kaboom' });
    expect(store.get('c')).toMatchObject({ value: 'ok-c', status: 'fresh' });

    expect(summary.results).toEqual([
      { name: 'a', status: 'fresh' },
      {
        name: 'b',
        status: 'error',
        error: 'kaboom',
        failureKind: 'script-error',
      },
      { name: 'c', status: 'fresh' },
    ]);
    expect(summary.freshCount).toBe(2);
    expect(summary.errorCount).toBe(1);
  });

  it.each([
    ['manual', 'manual'],
    ['auto', 'auto'],
    ['scheduled', 'auto'],
  ] as [RunTrigger, ExecutionTier][])(
    'trigger %s drives the executor to receive tier %s',
    async (trigger, expectedTier) => {
      const store = createValueStore();
      const seenTiers: ExecutionTier[] = [];
      const executor: ScriptExecutor = async ({ tier }) => {
        seenTiers.push(tier);
        return { ok: true, value: 1 };
      };

      const summary = await runDocumentScripts({
        scripts: [block({ name: 'x' })],
        executor,
        trigger,
        store,
      });

      expect(seenTiers).toEqual([expectedTier]);
      expect(summary.tier).toBe(expectedTier);
    },
  );

  it('resolves `src` via `loadSource` and runs the loaded code', async () => {
    const store = createValueStore();
    const seenCode: string[] = [];
    const executor: ScriptExecutor = async ({ code }) => {
      seenCode.push(code);
      return { ok: true, value: 'ran' };
    };

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'etl', code: '', src: 'scripts/etl.lua' })],
      executor,
      trigger: 'manual',
      store,
      loadSource: (src) => `-- loaded from ${src}\nreturn 1`,
    });

    expect(seenCode).toEqual(['-- loaded from scripts/etl.lua\nreturn 1']);
    expect(store.get('etl')).toMatchObject({ value: 'ran', status: 'fresh' });
    expect(summary.results[0]).toEqual({ name: 'etl', status: 'fresh' });
  });

  it('supports an async `loadSource`', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async ({ code }) => ({
      ok: true,
      value: code,
    });

    await runDocumentScripts({
      scripts: [block({ name: 'etl', code: '', src: 'scripts/etl.lua' })],
      executor,
      trigger: 'manual',
      store,
      loadSource: async (src) => `async:${src}`,
    });

    expect(store.get('etl')).toMatchObject({ value: 'async:scripts/etl.lua' });
  });

  it('records an error status (not a throw) when `src` is set but no `loadSource` is provided', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () => ({
      ok: true,
      value: 'unreachable',
    });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'etl', code: '', src: 'scripts/etl.lua' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('etl')?.status).toBe('error');
    expect(store.get('etl')?.error).toContain('loadSource');
    expect(summary.results[0]?.status).toBe('error');
    expect(summary.errorCount).toBe(1);
  });

  it('contains a `loadSource` that throws, as an error status rather than a thrown exception', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () => ({
      ok: true,
      value: 'unreachable',
    });

    await expect(
      runDocumentScripts({
        scripts: [block({ name: 'etl', code: '', src: 'scripts/etl.lua' })],
        executor,
        trigger: 'manual',
        store,
        loadSource: () => {
          throw new Error('disk on fire');
        },
      }),
    ).resolves.toBeDefined();

    expect(store.get('etl')).toMatchObject({
      status: 'error',
      error: 'disk on fire',
    });
  });

  it('contains an executor that throws synchronously', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = (() => {
      throw new Error('executor exploded');
    }) as unknown as ScriptExecutor;

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('x')).toMatchObject({
      status: 'error',
      error: 'executor exploded',
    });
    expect(summary.errorCount).toBe(1);
  });

  it('contains an executor whose returned promise rejects', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () => {
      throw new Error('rejected');
    };

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'x' }), block({ name: 'y' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('x')).toMatchObject({
      status: 'error',
      error: 'rejected',
    });
    expect(store.get('y')).toMatchObject({
      status: 'error',
      error: 'rejected',
    });
    expect(summary.errorCount).toBe(2);
  });

  it('a script failing does not abort the rest of the batch (mixed throw + ok + error)', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async ({ code }) => {
      if (code === 'throws') throw new Error('boom');
      if (code === 'fails') {
        return { ok: false, error: { kind: 'script-error', message: 'nope' } };
      }
      return { ok: true, value: code };
    };

    const summary = await runDocumentScripts({
      scripts: [
        block({ name: 'a', code: 'throws' }),
        block({ name: 'b', code: 'fails' }),
        block({ name: 'c', code: 'ok' }),
      ],
      executor,
      trigger: 'manual',
      store,
    });

    expect(summary.results.map((r) => r.status)).toEqual([
      'error',
      'error',
      'fresh',
    ]);
    expect(store.get('c')).toMatchObject({ value: 'ok', status: 'fresh' });
  });

  it('never rewrites or appends to a tier-blocked failure message under the auto tier — the executor message is stored verbatim', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async (): Promise<ExecuteResult> => ({
      ok: false,
      error: { kind: 'tier-blocked', message: 'net.post is not permitted' },
    });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'post-stats' })],
      executor,
      trigger: 'auto',
      store,
    });

    const stored = store.get('post-stats');
    expect(stored?.status).toBe('error');
    expect(stored?.error).toBe('net.post is not permitted');
    expect(stored?.failureKind).toBe('tier-blocked');
    expect(summary.results[0]?.error).toBe('net.post is not permitted');
    expect(summary.results[0]?.failureKind).toBe('tier-blocked');
    // The old " (requires manual run" rewrite is gone entirely.
    expect(stored?.error).not.toContain('requires manual run');
  });

  it('never rewrites a capability-denied failure message under the manual tier', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async (): Promise<ExecuteResult> => ({
      ok: false,
      error: { kind: 'capability-denied', message: 'host not granted' },
    });

    await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('x')?.error).toBe('host not granted');
    expect(store.get('x')?.failureKind).toBe('capability-denied');
  });

  it('never rewrites a script-error-kind failure message under the auto tier', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async (): Promise<ExecuteResult> => ({
      ok: false,
      error: { kind: 'script-error', message: 'syntax error' },
    });

    await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'auto',
      store,
    });

    expect(store.get('x')?.error).toBe('syntax error');
    expect(store.get('x')?.failureKind).toBe('script-error');
  });

  it('a capability-denied failure under the auto tier is stored verbatim too — capability-denied is never conflated with tier-blocked', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async (): Promise<ExecuteResult> => ({
      ok: false,
      error: { kind: 'capability-denied', message: 'host not granted' },
    });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'auto',
      store,
    });

    expect(store.get('x')?.error).toBe('host not granted');
    expect(store.get('x')?.failureKind).toBe('capability-denied');
    expect(summary.results[0]?.failureKind).toBe('capability-denied');
  });

  it('an executor returning a garbage/forged failure kind never throws and lands as script-error', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () =>
      ({
        ok: false,
        error: { kind: 'capability', message: 'forged kind' },
      }) as unknown as ExecuteResult;

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('x')?.failureKind).toBe('script-error');
    expect(store.get('x')?.error).toBe('forged kind');
    expect(summary.results[0]?.failureKind).toBe('script-error');
  });

  it('an executor returning __proto__ as a forged kind never throws and lands as script-error', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () =>
      ({
        ok: false,
        error: { kind: '__proto__', message: 'x' },
      }) as unknown as ExecuteResult;

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('x')?.failureKind).toBe('script-error');
    expect(summary.results[0]?.failureKind).toBe('script-error');
  });

  it('failureKind lands on both StoredValue and RunSummaryEntry for every failure path', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () => ({
      ok: false,
      error: { kind: 'limit', message: 'exceeded' },
    });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('x')?.failureKind).toBe('limit');
    expect(summary.results[0]?.failureKind).toBe('limit');
  });

  it('a fresh (successful) entry never carries a failureKind', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () => ({ ok: true, value: 1 });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('x')?.failureKind).toBeUndefined();
    expect(summary.results[0]?.failureKind).toBeUndefined();
  });

  it('the internal runtime failures (missing loadSource, loadSource throwing, executor throwing) all classify as script-error', async () => {
    const storeA = createValueStore();
    await runDocumentScripts({
      scripts: [block({ name: 'a', code: '', src: 'x.lua' })],
      executor: async () => ({ ok: true, value: 'unreachable' }),
      trigger: 'manual',
      store: storeA,
    });
    expect(storeA.get('a')?.failureKind).toBe('script-error');

    const storeB = createValueStore();
    await runDocumentScripts({
      scripts: [block({ name: 'b', code: '', src: 'x.lua' })],
      executor: async () => ({ ok: true, value: 'unreachable' }),
      trigger: 'manual',
      store: storeB,
      loadSource: () => {
        throw new Error('disk on fire');
      },
    });
    expect(storeB.get('b')?.failureKind).toBe('script-error');

    const storeC = createValueStore();
    const throwingExecutor: ScriptExecutor = (() => {
      throw new Error('executor exploded');
    }) as unknown as ScriptExecutor;
    await runDocumentScripts({
      scripts: [block({ name: 'c' })],
      executor: throwingExecutor,
      trigger: 'manual',
      store: storeC,
    });
    expect(storeC.get('c')?.failureKind).toBe('script-error');
  });

  it('duplicate names: the last run in document order wins in the store, and the summary flags the duplicate', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async ({ code }) => ({
      ok: true,
      value: code,
    });

    const summary = await runDocumentScripts({
      scripts: [
        block({ name: 'stars', code: 'first' }),
        block({ name: 'stars', code: 'second' }),
      ],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('stars')).toMatchObject({
      value: 'second',
      status: 'fresh',
    });
    expect(summary.results).toEqual([
      { name: 'stars', status: 'fresh' },
      { name: 'stars', status: 'fresh' },
    ]);
    expect(summary.duplicateNames).toEqual(['stars']);
  });

  it('has no duplicates when every name is unique', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () => ({ ok: true, value: 1 });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'a' }), block({ name: 'b' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(summary.duplicateNames).toEqual([]);
  });

  it('an empty script list produces an empty summary and touches the store not at all', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () => ({ ok: true, value: 1 });

    const summary = await runDocumentScripts({
      scripts: [],
      executor,
      trigger: 'manual',
      store,
    });

    expect(summary.results).toEqual([]);
    expect(summary.freshCount).toBe(0);
    expect(summary.errorCount).toBe(0);
    expect(summary.duplicateNames).toEqual([]);
  });
});

describe('runDocumentScripts: publishing (docs/scripting.md vault)', () => {
  it('publish-flagged block with no `vault` option: note store still gets the value, publish is "not-granted", no error', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async () => ({ ok: true, value: 42 });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'gh', publish: true })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('gh')).toMatchObject({ value: 42, status: 'fresh' });
    expect(summary.results).toEqual([
      { name: 'gh', status: 'fresh', publish: 'not-granted' },
    ]);
    expect(summary.errorCount).toBe(0);
    expect(summary.publishedCount).toBe(0);
  });

  it.each(['auto', 'scheduled', 'manual'] as RunTrigger[])(
    'publish-flagged block + a vault writer publishes under trigger %s',
    async (trigger) => {
      const store = createValueStore();
      const { store: vaultStore, writer } = createVaultStore();
      const executor: ScriptExecutor = async () => ({ ok: true, value: 7 });

      const summary = await runDocumentScripts({
        scripts: [block({ name: 'gh', publish: true })],
        executor,
        trigger,
        store,
        vault: writer,
      });

      expect(vaultStore.get('gh')).toMatchObject({ value: 7, status: 'fresh' });
      expect(summary.results[0]).toMatchObject({
        name: 'gh',
        status: 'fresh',
        publish: 'published',
      });
      expect(summary.publishedCount).toBe(1);
    },
  );

  it('a non-publish block with a vault writer never calls the writer', async () => {
    const store = createValueStore();
    let calls = 0;
    const writer: VaultWriter = {
      publish: () => {
        calls++;
        return { ok: true };
      },
    };
    const executor: ScriptExecutor = async () => ({ ok: true, value: 1 });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'gh' })],
      executor,
      trigger: 'manual',
      store,
      vault: writer,
    });

    expect(calls).toBe(0);
    expect(summary.results[0]?.publish).toBeUndefined();
  });

  it('a publish-flagged block whose executor fails: writer is never called and `publish` is left undefined', async () => {
    const store = createValueStore();
    let calls = 0;
    const writer: VaultWriter = {
      publish: () => {
        calls++;
        return { ok: true };
      },
    };
    const executor: ScriptExecutor = async () => ({
      ok: false,
      error: { kind: 'script-error', message: 'boom' },
    });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'gh', publish: true })],
      executor,
      trigger: 'manual',
      store,
      vault: writer,
    });

    expect(calls).toBe(0);
    expect(summary.results[0]?.status).toBe('error');
    expect(summary.results[0]?.publish).toBeUndefined();
    expect(summary.publishedCount).toBe(0);
  });

  it('a writer returning ok:false: publish is "rejected", publishError is set, note status stays fresh, errorCount stays 0', async () => {
    const store = createValueStore();
    const writer: VaultWriter = {
      publish: () => ({
        ok: false,
        error: { kind: 'claimed', message: 'gh is already claimed' },
      }),
    };
    const executor: ScriptExecutor = async () => ({ ok: true, value: 1 });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'gh', publish: true })],
      executor,
      trigger: 'manual',
      store,
      vault: writer,
    });

    expect(store.get('gh')).toMatchObject({ value: 1, status: 'fresh' });
    expect(summary.results[0]).toMatchObject({
      name: 'gh',
      status: 'fresh',
      publish: 'rejected',
      publishError: 'gh is already claimed',
    });
    expect(summary.errorCount).toBe(0);
    expect(summary.publishedCount).toBe(0);
  });

  it('a writer that throws synchronously: rejected, no exception escapes runDocumentScripts', async () => {
    const store = createValueStore();
    const writer: VaultWriter = {
      publish: () => {
        throw new Error('writer exploded');
      },
    };
    const executor: ScriptExecutor = async () => ({ ok: true, value: 1 });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'gh', publish: true })],
      executor,
      trigger: 'manual',
      store,
      vault: writer,
    });

    expect(summary.results[0]).toMatchObject({
      status: 'fresh',
      publish: 'rejected',
      publishError: 'writer exploded',
    });
  });

  it('a writer whose returned promise rejects: rejected, no exception escapes runDocumentScripts', async () => {
    const store = createValueStore();
    const writer: VaultWriter = {
      publish: async () => {
        throw new Error('writer promise rejected');
      },
    };
    const executor: ScriptExecutor = async () => ({ ok: true, value: 1 });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'gh', publish: true })],
      executor,
      trigger: 'manual',
      store,
      vault: writer,
    });

    expect(summary.results[0]).toMatchObject({
      status: 'fresh',
      publish: 'rejected',
      publishError: 'writer promise rejected',
    });
  });

  it('duplicate publish-flagged names: both attempts are recorded and both publish', async () => {
    const store = createValueStore();
    const { writer } = createVaultStore();
    const executor: ScriptExecutor = async ({ code }) => ({
      ok: true,
      value: code,
    });

    const summary = await runDocumentScripts({
      scripts: [
        block({ name: 'gh', publish: true, code: 'first' }),
        block({ name: 'gh', publish: true, code: 'second' }),
      ],
      executor,
      trigger: 'manual',
      store,
      vault: writer,
    });

    expect(summary.results).toEqual([
      { name: 'gh', status: 'fresh', publish: 'published' },
      { name: 'gh', status: 'fresh', publish: 'published' },
    ]);
    expect(summary.duplicateNames).toEqual(['gh']);
    expect(summary.publishedCount).toBe(2);
  });

  it('publishedCount only counts entries with publish === "published"', async () => {
    const store = createValueStore();
    const writer: VaultWriter = {
      publish: (name) =>
        name === 'good'
          ? { ok: true }
          : { ok: false, error: { kind: 'claimed', message: 'no' } },
    };
    const executor: ScriptExecutor = async () => ({ ok: true, value: 1 });

    const summary = await runDocumentScripts({
      scripts: [
        block({ name: 'good', publish: true }),
        block({ name: 'bad', publish: true }),
        block({ name: 'unflagged' }),
      ],
      executor,
      trigger: 'manual',
      store,
      vault: writer,
    });

    expect(summary.publishedCount).toBe(1);
  });
});

describe('runDocumentScripts — the doc view a script receives', () => {
  it('hands every script the listing the caller supplied', async () => {
    const store = createValueStore();
    const listing = {
      directives: [
        {
          name: 'q',
          form: 'container' as const,
          attributes: { a: '1' },
          text: 'x',
        },
      ],
      truncated: false,
    };
    const seen: unknown[] = [];
    const executor: ScriptExecutor = async ({ doc }) => {
      seen.push(doc?.directives);
      return { ok: true, value: 1 };
    };

    await runDocumentScripts({
      scripts: [block({ name: 'a' }), block({ name: 'b' })],
      executor,
      trigger: 'manual',
      store,
      doc: { directives: listing },
    });

    expect(seen).toEqual([listing, listing]);
  });

  it('hands an empty listing, never a missing doc, when the caller supplied none', async () => {
    const store = createValueStore();
    let received: unknown;
    const executor: ScriptExecutor = async ({ doc }) => {
      received = doc?.directives;
      return { ok: true, value: 1 };
    };

    await runDocumentScripts({
      scripts: [block({ name: 'a' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(received).toEqual({ directives: [], truncated: false });
  });

  it('lets a script read a value produced above it and refuses one produced below', async () => {
    const store = createValueStore();
    const reads: Record<string, unknown> = {};
    const executor: ScriptExecutor = async ({ code, doc }) => {
      if (code !== 'second') return { ok: true, value: { n: 7 } };
      reads.above = doc?.value('first');
      reads.below = doc?.value('third');
      reads.self = doc?.value('second');
      reads.unknown = doc?.value('nowhere');
      return { ok: true, value: 2 };
    };

    await runDocumentScripts({
      scripts: [
        block({ name: 'first', code: 'first' }),
        block({ name: 'second', code: 'second' }),
        block({ name: 'third', code: 'third' }),
      ],
      executor,
      trigger: 'manual',
      store,
    });

    expect(reads.above).toEqual({ ok: true, value: { n: 7 } });
    expect(reads.below).toEqual({
      ok: false,
      message: 'reads "third", which runs later in the note',
    });
    expect(reads.self).toEqual({
      ok: false,
      message: 'reads "second", which runs later in the note',
    });
    expect(reads.unknown).toEqual({ ok: true, value: undefined });
  });

  it('is not tier-gated: an auto run gets the same view a manual run gets', async () => {
    const store = createValueStore();
    const listing = { directives: [], truncated: true };
    const seen: (boolean | undefined)[] = [];
    const executor: ScriptExecutor = async ({ doc }) => {
      seen.push(doc?.directives.truncated);
      return { ok: true, value: 1 };
    };

    for (const trigger of ['manual', 'auto', 'scheduled'] as RunTrigger[]) {
      await runDocumentScripts({
        scripts: [block({ name: 'a' })],
        executor,
        trigger,
        store,
        doc: { directives: listing },
      });
    }

    expect(seen).toEqual([true, true, true]);
  });

  it("reads a failed script's name as nil rather than blaming the reader", async () => {
    const store = createValueStore();
    let read: unknown;
    const executor: ScriptExecutor = async ({ code, doc }) => {
      if (code === 'broken') {
        return { ok: false, error: { kind: 'script-error', message: 'boom' } };
      }
      read = doc?.value('broken');
      return { ok: true, value: 1 };
    };

    await runDocumentScripts({
      scripts: [
        block({ name: 'broken', code: 'broken' }),
        block({ name: 'reader', code: 'reader' }),
      ],
      executor,
      trigger: 'manual',
      store,
    });

    expect(read).toEqual({ ok: true, value: undefined });
  });
});
