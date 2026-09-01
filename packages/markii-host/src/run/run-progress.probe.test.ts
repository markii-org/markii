import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnRun } from './run-host';

/**
 * Executed probe for the per-script progress protocol (GitHub issue #35).
 * Every case here spawns a REAL `worker_thread` running the real
 * `worker-entry.ts` through the real wasmoon sandbox — no fake isolate, no
 * stubbed messages — because the claim being made is about the WIRE: that a
 * real run sends one message per script, in document order, and that every
 * one of them arrives before the single result message settles the run.
 *
 * `./run-progress.test.ts` covers the rules `spawnRun` applies to those
 * messages (the guard, duplicate ordinals, a settled run). This file covers
 * that they are genuinely sent, and that a watchdog kill part-way through
 * still leaves the values that had already landed.
 *
 * These run against the Node isolate. The Web Worker isolate posts the same
 * message from the same shared `run-job.ts` (that sharing is the whole
 * reason the module exists), so the two cannot differ in shape or order.
 */

const WORKER_PATH = path.join(__dirname, 'worker-entry.ts');

function fence(name: string, body: string): string {
  return '```lua {name=' + name + '}\n' + body + '\n```\n';
}

describe('run progress over a real worker', () => {
  it('delivers one value per script, in document order, all before the run settles', async () => {
    const text =
      fence('first', 'return 1') +
      '\n' +
      fence('second', 'return "two"') +
      '\n' +
      fence('third', 'return { n = 3 }');

    // One timeline for both kinds of event: every progress callback
    // appends, and the settlement appends after the await. A protocol that
    // batched values into the final message would produce a timeline with
    // 'settled' first.
    const timeline: string[] = [];
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 15_000,
      workerPath: WORKER_PATH,
      onValue: (name, value, index) => {
        timeline.push(
          `${String(index)}:${name}=${JSON.stringify(value.value)}`,
        );
      },
    });
    timeline.push('settled');

    expect(timeline).toEqual([
      '0:first=1',
      '1:second="two"',
      '2:third={"n":3}',
      'settled',
    ]);
    expect(result.failures).toEqual([]);
    // The final result still carries the complete store — progress is an
    // addition to the protocol, not a replacement for it.
    expect(result.values.first?.value).toBe(1);
    expect(result.values.third?.value).toEqual({ n: 3 });
  }, 30_000);

  it('reports a failed script as it happens, rather than only in the final failures list', async () => {
    const text =
      fence('good', 'return 1') +
      '\n' +
      fence('bad', 'error("this one fails")') +
      '\n' +
      fence('after', 'return 3');

    const seen: Array<{ name: string; status: string }> = [];
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 15_000,
      workerPath: WORKER_PATH,
      onValue: (name, value) => seen.push({ name, status: value.status }),
    });

    expect(seen).toEqual([
      { name: 'good', status: 'fresh' },
      { name: 'bad', status: 'error' },
      { name: 'after', status: 'fresh' },
    ]);
    expect(result.failures.map((failure) => failure.name)).toEqual(['bad']);
  }, 30_000);

  it('a watchdog kill after two scripts leaves exactly those two values, delivered and returned', async () => {
    // The third script never finishes. Its own in-VM limits are lifted well
    // past the external deadline on purpose, so what kills this run is the
    // watchdog in `run-host.ts` — the case the issue asks about — and not
    // `@markii/lua`'s inner instruction/wall-clock cap, which would have
    // produced an ordinary failed script and a normal result message.
    const text =
      fence('a', 'return 1') +
      '\n' +
      fence('b', 'return 2') +
      '\n' +
      fence('c', 'while true do end');

    const seen: string[] = [];
    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 4000,
      limits: { wallClockMs: 120_000, maxInstructions: 10_000_000_000 },
      workerPath: WORKER_PATH,
      onValue: (name) => seen.push(name),
    });

    expect(seen).toEqual(['a', 'b']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.kind).toBe('limit');
    expect(result.failures[0]?.message).toMatch(/watchdog/);
    // The killed run is settled with exactly the values that arrived: the
    // two scripts that finished keep their numbers, and the one that was
    // still running has none. Before this, a killed run came back empty and
    // wiped the note's last-known values along with it.
    expect(Object.keys(result.values).sort()).toEqual(['a', 'b']);
    expect(result.values.a?.value).toBe(1);
    expect(result.values.b?.value).toBe(2);
  }, 30_000);

  it('a run with no scripts reports nothing and settles normally', async () => {
    const seen: string[] = [];
    const result = await spawnRun({
      text: '# just prose\n',
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 15_000,
      workerPath: WORKER_PATH,
      onValue: (name) => seen.push(name),
    });

    expect(seen).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.values).toEqual({});
  }, 30_000);
});
