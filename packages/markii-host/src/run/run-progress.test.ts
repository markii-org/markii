import { describe, expect, it, vi } from 'vitest';
import { spawnRun } from './run-host';
import { isRunProgress } from './run-progress';
import type { IsolateSpawner, RunIsolate } from './isolate';
import type { StoredValue } from '@markii/runtime';

/**
 * The per-script progress protocol (GitHub issue #35), at the level a fake
 * isolate can show: the hostile-shape guard, the ordering/duplicate rules
 * `spawnRun` enforces on the messages, and the promise that a run killed
 * part-way still carries the values that already arrived.
 *
 * The EXECUTED half — a real worker thread genuinely sending these ahead of
 * its result, and a real watchdog kill leaving exactly the values that
 * landed — is `./run-progress.probe.test.ts`. Both are required: this file
 * proves the rules, that one proves the wire.
 */

function fakeIsolate() {
  const listeners: {
    message?: (m: unknown) => void;
    error?: (e: unknown) => void;
    exit?: (c: number | null) => void;
  } = {};
  const isolate: RunIsolate = {
    send: () => {},
    kill: () => {},
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
  return { isolate, listeners };
}

const baseOptions = {
  text: '# nothing to run\n',
  netAllowlist: [],
  cacheSnapshot: {},
  timeoutMs: 5000,
  workerPath: '/nonexistent/worker.js',
};

function progress(index: number, name: string, value: unknown): unknown {
  return {
    kind: 'markii:run-progress',
    index,
    name,
    value: { value, status: 'fresh', ranAt: 1 } satisfies StoredValue,
  };
}

const emptyResult = { values: {}, failures: [], cacheSnapshot: {} };

describe('isRunProgress', () => {
  it('accepts a well-formed progress message', () => {
    expect(isRunProgress(progress(0, 'a', 1))).toBe(true);
  });

  it('rejects a run result, so the two can never be confused', () => {
    expect(isRunProgress(emptyResult)).toBe(false);
  });

  it.each([
    ['a non-object', 42],
    ['null', null],
    [
      'a wrong kind',
      { kind: 'markii:net-reply', index: 0, name: 'a', value: {} },
    ],
    ['a missing kind', { index: 0, name: 'a', value: { status: 'fresh' } }],
    [
      'a non-integer index',
      {
        kind: 'markii:run-progress',
        index: 1.5,
        name: 'a',
        value: { status: 'fresh' },
      },
    ],
    [
      'a negative index',
      {
        kind: 'markii:run-progress',
        index: -1,
        name: 'a',
        value: { status: 'fresh' },
      },
    ],
    [
      'a non-string name',
      {
        kind: 'markii:run-progress',
        index: 0,
        name: 7,
        value: { status: 'fresh' },
      },
    ],
    ['a missing value', { kind: 'markii:run-progress', index: 0, name: 'a' }],
    [
      'an array value',
      { kind: 'markii:run-progress', index: 0, name: 'a', value: [] },
    ],
    [
      'an unknown status',
      {
        kind: 'markii:run-progress',
        index: 0,
        name: 'a',
        value: { status: 'cooked' },
      },
    ],
  ])('rejects %s', (_label, message) => {
    expect(isRunProgress(message)).toBe(false);
  });

  it('rejects a `kind` merely INHERITED from a prototype, never own', () => {
    const hostile = Object.create({ kind: 'markii:run-progress' }) as Record<
      string,
      unknown
    >;
    hostile.index = 0;
    hostile.name = 'a';
    hostile.value = { status: 'fresh' };
    // `kind` resolves through the prototype chain, so a plain read would
    // see it; the guard reads it the same way every other shape check in
    // this package does and must not be satisfied by an inherited member.
    expect(isRunProgress(hostile)).toBe(false);
  });
});

describe('spawnRun — progress messages (GitHub issue #35)', () => {
  it('reports each value through onValue and still settles on the result message', async () => {
    const fake = fakeIsolate();
    const spawnIsolate = vi.fn<IsolateSpawner>(() => fake.isolate);
    const seen: Array<[string, unknown, number]> = [];

    const run = spawnRun({
      ...baseOptions,
      spawnIsolate,
      onValue: (name, value, index) => seen.push([name, value.value, index]),
    });
    fake.listeners.message?.(progress(0, 'a', 1));
    fake.listeners.message?.(progress(1, 'b', 2));
    fake.listeners.message?.({
      values: {
        a: { value: 1, status: 'fresh' },
        b: { value: 2, status: 'fresh' },
      },
      failures: [],
      cacheSnapshot: {},
    });

    const result = await run;
    expect(seen).toEqual([
      ['a', 1, 0],
      ['b', 2, 1],
    ]);
    expect(Object.keys(result.values)).toEqual(['a', 'b']);
  });

  it('drops a repeated or out-of-order ordinal instead of overwriting a value that already landed', async () => {
    const fake = fakeIsolate();
    const spawnIsolate = vi.fn<IsolateSpawner>(() => fake.isolate);
    const seen: string[] = [];

    const run = spawnRun({
      ...baseOptions,
      spawnIsolate,
      onValue: (name) => seen.push(name),
    });
    fake.listeners.message?.(progress(0, 'a', 1));
    fake.listeners.message?.(progress(1, 'b', 2));
    // A misbehaving isolate replaying an ordinal it already used, and one
    // arriving behind the ordinal already accepted.
    fake.listeners.message?.(progress(1, 'b', 'forged'));
    fake.listeners.message?.(progress(0, 'a', 'forged'));
    fake.listeners.exit?.(0);

    const result = await run;
    expect(seen).toEqual(['a', 'b']);
    expect(result.values.a?.value).toBe(1);
    expect(result.values.b?.value).toBe(2);
  });

  it('a run killed by the watchdog still carries the values that already arrived', async () => {
    const fake = fakeIsolate();
    const spawnIsolate = vi.fn<IsolateSpawner>(() => fake.isolate);

    const run = spawnRun({ ...baseOptions, timeoutMs: 30, spawnIsolate });
    fake.listeners.message?.(progress(0, 'a', 1));
    fake.listeners.message?.(progress(1, 'b', 2));
    // ...and then nothing: the isolate never sends a result.

    const result = await run;
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.kind).toBe('limit');
    expect(result.values.a?.value).toBe(1);
    expect(result.values.b?.value).toBe(2);
  });

  it('a run whose isolate dies mid-way keeps the same values', async () => {
    const fake = fakeIsolate();
    const spawnIsolate = vi.fn<IsolateSpawner>(() => fake.isolate);

    const run = spawnRun({ ...baseOptions, spawnIsolate });
    fake.listeners.message?.(progress(0, 'a', 1));
    fake.listeners.error?.(new Error('isolate exploded'));

    const result = await run;
    expect(result.failures[0]?.name).toBe('<worker>');
    expect(result.values.a?.value).toBe(1);
  });

  it('ignores progress that arrives after the run has already settled', async () => {
    const fake = fakeIsolate();
    const spawnIsolate = vi.fn<IsolateSpawner>(() => fake.isolate);
    const seen: string[] = [];

    const run = spawnRun({
      ...baseOptions,
      spawnIsolate,
      onValue: (name) => seen.push(name),
    });
    fake.listeners.message?.(emptyResult);
    await run;
    fake.listeners.message?.(progress(0, 'late', 1));

    expect(seen).toEqual([]);
  });

  it('a throwing onValue never breaks the never-rejects contract', async () => {
    const fake = fakeIsolate();
    const spawnIsolate = vi.fn<IsolateSpawner>(() => fake.isolate);

    const run = spawnRun({
      ...baseOptions,
      spawnIsolate,
      onValue: () => {
        throw new Error('host reporting blew up');
      },
    });
    fake.listeners.message?.(progress(0, 'a', 1));
    fake.listeners.message?.(emptyResult);

    await expect(run).resolves.toMatchObject({ failures: [] });
  });

  it('keeps a script named __proto__ as an own key of the values a killed run reports', async () => {
    const fake = fakeIsolate();
    const spawnIsolate = vi.fn<IsolateSpawner>(() => fake.isolate);

    const run = spawnRun({ ...baseOptions, timeoutMs: 30, spawnIsolate });
    fake.listeners.message?.(progress(0, '__proto__', 'legal name'));

    const result = await run;
    expect(Object.hasOwn(result.values, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(result.values)).toBe(Object.prototype);
  });
});
