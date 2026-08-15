import type { ScriptBlock } from '@markii/core';
import { describe, expect, it } from 'vitest';
import { createValueStore } from './store';
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
        return { ok: false, error: { kind: 'runtime', message: 'kaboom' } };
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
      { name: 'b', status: 'error', error: 'kaboom' },
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
        return { ok: false, error: { kind: 'runtime', message: 'nope' } };
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

  it('rewrites a capability-kind failure under the auto tier to say it requires a manual run', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async (): Promise<ExecuteResult> => ({
      ok: false,
      error: { kind: 'capability', message: 'net.post is not permitted' },
    });

    const summary = await runDocumentScripts({
      scripts: [block({ name: 'post-stats' })],
      executor,
      trigger: 'auto',
      store,
    });

    const stored = store.get('post-stats');
    expect(stored?.status).toBe('error');
    expect(stored?.error).toContain('net.post is not permitted');
    expect(stored?.error?.toLowerCase()).toContain('manual run');
    expect(summary.results[0]?.error?.toLowerCase()).toContain('manual run');
  });

  it('does NOT rewrite a capability-kind failure under the manual tier', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async (): Promise<ExecuteResult> => ({
      ok: false,
      error: { kind: 'capability', message: 'host not granted' },
    });

    await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'manual',
      store,
    });

    expect(store.get('x')?.error).toBe('host not granted');
  });

  it('does NOT rewrite a non-capability-kind failure under the auto tier', async () => {
    const store = createValueStore();
    const executor: ScriptExecutor = async (): Promise<ExecuteResult> => ({
      ok: false,
      error: { kind: 'runtime', message: 'syntax error' },
    });

    await runDocumentScripts({
      scripts: [block({ name: 'x' })],
      executor,
      trigger: 'auto',
      store,
    });

    expect(store.get('x')?.error).toBe('syntax error');
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
