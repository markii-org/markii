import { describe, expect, it } from 'vitest';
import { runScript } from './sandbox';
import type { PackModuleResolver } from './require';

function run(resolver: PackModuleResolver, wallClockMs = 5_000) {
  return runScript({
    code: 'local m = require("ana/util"); return m.v',
    tier: 'manual',
    packModuleResolver: resolver,
    limits: { wallClockMs },
  });
}

describe('PackModuleResolver may be async', () => {
  it('a sync resolver behaves as before', async () => {
    const r = await run(() => 'return { v = 1 }');
    expect(r).toEqual({ ok: true, value: 1 });
  });

  it('an async resolver is awaited', async () => {
    const r = await run(async () => 'return { v = 2 }');
    expect(r).toEqual({ ok: true, value: 2 });
  });

  it('an async resolver resolving undefined is "not found"', async () => {
    const r = await run(async () => undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('runtime');
      expect(r.error.message).toContain('no pack module');
    }
  });

  it('an async rejection fails like a sync throw', async () => {
    const asyncR = await run(async () => {
      throw new Error('boom');
    });
    const syncR = await run(() => {
      throw new Error('boom');
    });
    expect(asyncR.ok).toBe(false);
    expect(asyncR).toEqual(syncR);
  });

  it('a never-settling resolver ends the run at the wall-clock limit', async () => {
    const started = Date.now();
    const r = await run(() => new Promise<string | undefined>(() => {}), 200);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('limit');
      expect(r.error.limit).toBe('timeout');
    }
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
