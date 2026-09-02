import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunTrigger } from '@markii/runtime';
import type { BundleManifest } from '@markii/bundle';
import { spawnRun } from './run-host';

/**
 * GitHub issue #11: end-to-end proof, through a REAL `worker_thread` running
 * the real wasmoon sandbox, that the trigger the host sends actually caps
 * what a run may do. The unit-level gate lives in `@markii/runtime`
 * (`tierForTrigger`) and `@markii/lua` (the executor's read-only tier), but
 * these probes exercise the whole extension worker path — the surface the
 * pass-3 pentest report flagged as needing its own adversarial pass once
 * auto/scheduled execution shipped. `bundle.write` is the convenient
 * effectful operation to probe: it is allowed under the manual tier when the
 * grant is present, and must be refused under the read-only tier that
 * `'auto'`/`'scheduled'` map to, REGARDLESS of the grant.
 */

const WORKER_PATH = path.join(__dirname, 'worker-entry.ts');

function writeFence(): string {
  return (
    '```lua {name=w}\n' +
    'local ok = pcall(function() bundle.write("cache/out.json", "{}") end)\n' +
    'return ok\n' +
    '```\n'
  );
}

function manifest(): BundleManifest {
  return { spec: '0.1.0', permissions: { bundle: ['write:cache/'] } };
}

async function runWrite(trigger: RunTrigger) {
  return spawnRun({
    text: writeFence(),
    trigger,
    netAllowlist: [],
    cacheSnapshot: {},
    timeoutMs: 5000,
    workerPath: WORKER_PATH,
    bundle: {
      snapshot: {},
      manifest: manifest(),
      grantedBundlePermissions: ['write:cache/'],
    },
  });
}

describe('worker trigger tier gate (issue #11)', () => {
  it('manual trigger: bundle.write succeeds when granted (baseline)', async () => {
    const result = await runWrite('manual');
    expect(result.values.w?.value).toBe(true);
    expect(result.cacheOut?.['cache/out.json']).toBeDefined();
  }, 20000);

  it('auto trigger: bundle.write is refused under the read-only tier, even when granted', async () => {
    const result = await runWrite('auto');
    // The write did not happen: the pcall reported failure and nothing landed
    // in cacheOut.
    expect(result.values.w?.value).toBe(false);
    expect(result.cacheOut?.['cache/out.json']).toBeUndefined();
  }, 20000);

  it('scheduled trigger: identical read-only refusal', async () => {
    const result = await runWrite('scheduled');
    expect(result.values.w?.value).toBe(false);
    expect(result.cacheOut?.['cache/out.json']).toBeUndefined();
  }, 20000);

  it('a malformed trigger is rejected fail-closed (worker reports a malformed job)', async () => {
    const result = await spawnRun({
      text: '```lua {name=a}\nreturn 1\n```\n',
      // Deliberately invalid: the worker's isRunJob must refuse it rather than
      // coerce it to the full-capability manual default.
      trigger: 'bogus' as RunTrigger,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 5000,
      workerPath: WORKER_PATH,
    });
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.values.a).toBeUndefined();
  }, 20000);
});
