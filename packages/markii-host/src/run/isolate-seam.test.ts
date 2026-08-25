import { describe, expect, it, vi } from 'vitest';
import { spawnRun } from './run-host';
import type { RunIsolate, IsolateSpawner } from './isolate';

/**
 * A fake isolate: no thread, no process, no Lua. These tests are about the
 * CONTRACT `spawnRun` holds every isolate kind to — the watchdog, the
 * exactly-once settlement, the never-rejects promise — so that the Web
 * Worker implementation an Electron renderer needs inherits all of it
 * instead of reimplementing (and quietly weakening) any of it.
 */
function fakeIsolate() {
  const listeners: {
    message?: (m: unknown) => void;
    error?: (e: unknown) => void;
    exit?: (c: number | null) => void;
  } = {};
  const sent: unknown[] = [];
  let killed = 0;
  const isolate: RunIsolate = {
    send: (job) => {
      sent.push(job);
    },
    kill: () => {
      killed += 1;
    },
    onMessage: (l) => {
      listeners.message = l;
    },
    onError: (l) => {
      listeners.error = l;
    },
    onExit: (l) => {
      listeners.exit = l;
    },
  };
  return {
    isolate,
    listeners,
    sent,
    get killed() {
      return killed;
    },
  };
}

const baseOptions = {
  text: '# nothing to run\n',
  netAllowlist: [],
  cacheSnapshot: {},
  timeoutMs: 5000,
  workerPath: '/nonexistent/worker.js',
};

describe('the isolate seam', () => {
  it('spawns through the injected spawner, not worker_threads', async () => {
    const fake = fakeIsolate();
    const spawnIsolate = vi.fn<IsolateSpawner>(() => fake.isolate);

    const run = spawnRun({ ...baseOptions, spawnIsolate });
    fake.listeners.message?.({
      values: { a: 1 },
      failures: [],
      cacheSnapshot: {},
    });

    await expect(run).resolves.toMatchObject({ values: { a: 1 } });
    expect(spawnIsolate).toHaveBeenCalledTimes(1);
    expect(fake.sent).toHaveLength(1);
  });

  it('hands the entry path and heap cap to the spawner', async () => {
    const fake = fakeIsolate();
    const spawnIsolate = vi.fn<IsolateSpawner>(() => fake.isolate);

    const run = spawnRun({ ...baseOptions, spawnIsolate });
    fake.listeners.message?.({ values: {}, failures: [], cacheSnapshot: {} });
    await run;

    expect(spawnIsolate.mock.calls[0]?.[0]).toMatchObject({
      entryPath: '/nonexistent/worker.js',
      maxOldGenerationSizeMb: 128,
    });
  });

  it('kills the isolate when the watchdog fires, and reports a limit failure', async () => {
    const fake = fakeIsolate();
    const run = spawnRun({
      ...baseOptions,
      timeoutMs: 10,
      spawnIsolate: () => fake.isolate,
    });
    // The watchdog kills it; a real isolate then reports its exit, which is
    // what settles the run.
    await new Promise((r) => setTimeout(r, 40));
    expect(fake.killed).toBeGreaterThan(0);
    fake.listeners.exit?.(null);

    await expect(run).resolves.toMatchObject({
      failures: [expect.objectContaining({ kind: 'limit' })],
    });
  });

  it('never rejects when the isolate reports an error', async () => {
    const fake = fakeIsolate();
    const run = spawnRun({ ...baseOptions, spawnIsolate: () => fake.isolate });
    fake.listeners.error?.(new Error('isolate blew up'));

    await expect(run).resolves.toMatchObject({
      failures: [expect.objectContaining({ message: 'isolate blew up' })],
    });
  });

  it('never rejects when send() throws, e.g. an uncloneable job', async () => {
    const fake = fakeIsolate();
    const throwing: RunIsolate = {
      ...fake.isolate,
      send: () => {
        throw new Error('DataCloneError');
      },
    };
    await expect(
      spawnRun({ ...baseOptions, spawnIsolate: () => throwing }),
    ).resolves.toMatchObject({
      failures: [
        expect.objectContaining({
          message: expect.stringContaining('DataCloneError'),
        }),
      ],
    });
  });

  it('settles exactly once when several events race', async () => {
    const fake = fakeIsolate();
    const run = spawnRun({ ...baseOptions, spawnIsolate: () => fake.isolate });

    fake.listeners.message?.({
      values: { first: true },
      failures: [],
      cacheSnapshot: {},
    });
    fake.listeners.error?.(new Error('too late'));
    fake.listeners.exit?.(1);

    await expect(run).resolves.toMatchObject({ values: { first: true } });
  });

  it('an exit with no result is a failure, not a hang', async () => {
    const fake = fakeIsolate();
    const run = spawnRun({ ...baseOptions, spawnIsolate: () => fake.isolate });
    fake.listeners.exit?.(3);

    await expect(run).resolves.toMatchObject({
      failures: [
        expect.objectContaining({
          message: expect.stringContaining('exited unexpectedly'),
        }),
      ],
    });
  });
});
