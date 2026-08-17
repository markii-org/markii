import { describe, expect, it, vi } from 'vitest';
import type { ScriptBlock } from '@markii/core';
import { createValueStore } from './store.js';
import { createVaultStore } from './vault.js';
import { runDocumentScripts } from './run.js';
import type { ExecuteResult } from './run.js';

const okExec = () =>
  Promise.resolve({ ok: true, value: { stars: 7 } } satisfies ExecuteResult);
const failExec = () =>
  Promise.resolve({
    ok: false,
    error: { kind: 'runtime', message: 'boom' },
  } satisfies ExecuteResult);

function block(name: string, publish?: true): ScriptBlock {
  const b: ScriptBlock = { name, lang: 'lua', code: 'return 1' };
  if (publish) b.publish = true;
  return b;
}

describe('adversarial:publish gating', () => {
  it('publish-flagged with NO writer: value lands in note store, nothing published, no error', async () => {
    const store = createValueStore();
    const summary = await runDocumentScripts({
      scripts: [block('gh', true)],
      executor: okExec,
      trigger: 'manual',
      store,
    });
    expect(store.get('gh')?.value).toEqual({ stars: 7 });
    expect(summary.results[0]?.publish).toBe('not-granted');
    expect(summary.results[0]?.status).toBe('fresh');
    expect(summary.errorCount).toBe(0);
    expect(summary.publishedCount).toBe(0);
  });

  it.each(['auto', 'scheduled', 'manual'] as const)(
    'publishes under trigger %s when the writer is present (grant is the gate, not the tier)',
    async (trigger) => {
      const { store: vaultStore, writer } = createVaultStore();
      const summary = await runDocumentScripts({
        scripts: [block('gh', true)],
        executor: okExec,
        trigger,
        store: createValueStore(),
        vault: writer,
      });
      expect(summary.results[0]?.publish).toBe('published');
      expect(vaultStore.get('gh')?.value).toEqual({ stars: 7 });
      expect(summary.publishedCount).toBe(1);
    },
  );

  it('writer rejection (single-writer collision): run still succeeds, reportable status, no throw', async () => {
    const { store: vaultStore, writer } = createVaultStore({
      canPublish: () => false,
    });
    const summary = await runDocumentScripts({
      scripts: [block('gh', true)],
      executor: okExec,
      trigger: 'manual',
      store: createValueStore(),
      vault: writer,
    });
    expect(summary.results[0]?.publish).toBe('rejected');
    expect(summary.results[0]?.status).toBe('fresh');
    expect(summary.results[0]?.publishError).toBeTruthy();
    expect(summary.errorCount).toBe(0);
    expect(vaultStore.has('gh')).toBe(false);
  });

  it('writer that throws synchronously, and one whose promise rejects, both degrade to rejected', async () => {
    for (const writer of [
      {
        publish: () => {
          throw new Error('sync boom');
        },
      },
      { publish: () => Promise.reject(new Error('async boom')) },
    ]) {
      const summary = await runDocumentScripts({
        scripts: [block('gh', true)],
        executor: okExec,
        trigger: 'manual',
        store: createValueStore(),
        vault: writer,
      });
      expect(summary.results[0]?.publish).toBe('rejected');
      expect(summary.results[0]?.status).toBe('fresh');
      expect(summary.errorCount).toBe(0);
    }
  });

  it('a FAILED publish-flagged block never reaches the writer', async () => {
    const publish = vi.fn(() => ({ ok: true }) as const);
    const summary = await runDocumentScripts({
      scripts: [block('gh', true)],
      executor: failExec,
      trigger: 'manual',
      store: createValueStore(),
      vault: { publish },
    });
    expect(publish).not.toHaveBeenCalled();
    expect(summary.results[0]?.status).toBe('error');
    expect(summary.results[0]?.publish).toBeUndefined();
  });

  it('a non-publish block never reaches the writer even with a grant', async () => {
    const publish = vi.fn(() => ({ ok: true }) as const);
    await runDocumentScripts({
      scripts: [block('gh')],
      executor: okExec,
      trigger: 'manual',
      store: createValueStore(),
      vault: { publish },
    });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('adversarial:vault prototype safety', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    'publishing under the hostile name %s pollutes nothing and round-trips',
    async (hostile) => {
      const { store: vaultStore, writer } = createVaultStore();
      expect(vaultStore.has(hostile)).toBe(false);
      expect(vaultStore.get(hostile)).toBeUndefined();

      await runDocumentScripts({
        scripts: [block(hostile, true)],
        executor: okExec,
        trigger: 'manual',
        store: createValueStore(),
        vault: writer,
      });

      expect(vaultStore.get(hostile)?.value).toEqual({ stars: 7 });
      // No global pollution through any path.
      const probe: Record<string, unknown> = {};
      expect(probe.stars).toBeUndefined();
      expect(Object.prototype.toString).toBeTypeOf('function');
      expect({}.constructor).toBe(Object);
      // snapshot() spread must not have triggered a __proto__ setter
      const snap = vaultStore.snapshot();
      expect(Object.getPrototypeOf(snap)).toBe(Object.prototype);
      expect(Object.hasOwn(snap, hostile)).toBe(true);
    },
  );

  it('the read seam exposes no write method at runtime', () => {
    const { store: vaultStore } = createVaultStore();
    // `VaultStore` has no index signature, so TypeScript rejects a direct
    // cast to `Record<string, unknown>` (TS2352: the types do not overlap
    // sufficiently). Going through `unknown` is the strict-mode-legal way to
    // say what this test means: inspect the runtime object for members the
    // *type* deliberately does not declare — which is the whole point of
    // asserting that the read seam exposes no writer at runtime, not merely
    // that it is untyped at compile time.
    const seam = vaultStore as unknown as Record<string, unknown>;
    expect(seam.set).toBeUndefined();
    expect(seam.publish).toBeUndefined();
  });
});
