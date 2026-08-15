import { describe, expect, it, vi } from 'vitest';
import { createValueStore, runDocumentScripts } from '@markii/runtime';
import type { NetProvider } from './capabilities';
import { createLuaExecutor } from './executor';
import type { ScriptLimits } from './limits';

/** Small limits so this real-sandbox suite still runs in milliseconds, matching sandbox.test.ts's FAST_LIMITS. */
const FAST_LIMITS: Partial<ScriptLimits> = {
  maxInstructions: 2_000_000,
  wallClockMs: 500,
  hookIntervalInstructions: 5_000,
  maxMemoryBytes: 8 * 1024 * 1024,
};

/**
 * End-to-end proof of the Slice 2 run path (DESIGN.md §8) through the REAL
 * Lua sandbox (wasmoon) — not a mock executor: `ScriptBlock`-shaped values
 * (the same shape `@markii/core`'s `extractScripts` produces for
 * ` ```lua {name=...}` ` fences) go through `createLuaExecutor` ->
 * `runDocumentScripts` -> a real `ValueStore`.
 *
 * These are built by hand here rather than by actually calling
 * `@markii/core`'s `extractScripts` on parsed markdown, because
 * `@markii/lua` must never depend on `@markii/core` — see CLAUDE.md's
 * import rule and this package's `no-restricted-imports` guard in the root
 * `eslint.config.js`. `extractScripts` itself is already covered by
 * `@markii/core`'s own `scripts.test.ts`; what this suite proves is the
 * part that package can't: that the extracted shape really runs through
 * the real sandbox end-to-end, and that the trigger-tier security gate is
 * enforced by the real capability wiring, not just by a mocked executor
 * (see `@markii/runtime`'s `run.test.ts` for the mocked-executor coverage
 * of `runDocumentScripts` itself).
 */
describe('run path end-to-end (real wasmoon): ScriptBlock -> createLuaExecutor -> runDocumentScripts -> ValueStore', () => {
  it('a manual-trigger inline script lands its return value in the store as fresh', async () => {
    const store = createValueStore();
    const scripts = [{ name: 'answer', lang: 'lua', code: 'return 2 + 2' }];

    const summary = await runDocumentScripts({
      scripts,
      executor: createLuaExecutor({ limits: FAST_LIMITS }),
      trigger: 'manual',
      store,
    });

    expect(store.get('answer')).toMatchObject({ value: 4, status: 'fresh' });
    expect(summary.tier).toBe('manual');
    expect(summary.freshCount).toBe(1);
    expect(summary.errorCount).toBe(0);
  });

  it('the security gate holds end-to-end: an effectful net.post call under an auto trigger fails cleanly with no effect', async () => {
    const post = vi.fn(async (_url: string, _body: string) => ({
      status: 200,
      body: '{}',
    }));
    const net: NetProvider = {
      get: async () => ({ status: 200, body: '{}' }),
      post,
    };
    const store = createValueStore();
    const scripts = [
      {
        name: 'ship-it',
        lang: 'lua',
        code: 'return net.post("https://api.example.com/x", "payload")',
      },
    ];

    const summary = await runDocumentScripts({
      scripts,
      executor: createLuaExecutor({
        limits: FAST_LIMITS,
        net,
        // POST to this host IS granted — the point of this test is that
        // the 'auto' trigger's read-only tier blocks the effectful call
        // regardless of what was granted, not that it was ungranted.
        netGrants: { get: ['api.example.com'], post: ['api.example.com'] },
      }),
      trigger: 'auto',
      store,
    });

    // No effect: the real sandbox never even wires up `net.post` under the
    // read-only 'auto' tier (see @markii/lua's capabilities.ts — confirmed
    // by its own capabilities.test.ts: `type(net.post)` is `'nil'` under
    // 'auto'), so the host-provided POST implementation was never invoked.
    expect(post).not.toHaveBeenCalled();

    expect(summary.tier).toBe('auto');
    expect(summary.errorCount).toBe(1);
    const stored = store.get('ship-it');
    expect(stored?.status).toBe('error');
    expect(stored?.value).toBeUndefined();
    // Because `net.post` is left entirely undefined (rather than wired to
    // a function that raises a tagged capability error) under 'auto', this
    // particular failure surfaces as an ordinary Lua "attempt to call a
    // nil value" runtime error, not a `'capability'`-kind one — so
    // `runDocumentScripts`'s auto+capability "requires manual run" message
    // rewrite does not fire for THIS specific real-sandbox case (that
    // rewrite is exercised directly, with a mocked capability-kind
    // failure, in @markii/runtime's own run.test.ts). What this test
    // proves is the load-bearing security property itself: the effectful
    // call genuinely could not run under 'auto' — not merely that it was
    // reported as denied — with zero observable effect on the host.
    expect(stored?.error).toContain('nil value');
  });
});
