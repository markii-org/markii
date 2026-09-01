import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawnRun } from './run-host';

/**
 * Executed probe for the note-scoped `doc` view (GitHub issue #33) on the
 * HOST path: every case here spawns a REAL `worker_thread` running the
 * real `worker-entry.ts` through the real wasmoon sandbox, the same way
 * `run-host.test.ts` does. Unit tests in `@markii/runtime` and
 * `@markii/lua` cover the listing and the table; what only this level can
 * show is that the listing `run-job.ts` builds from the note actually
 * reaches a script inside the isolate, with no protocol change and no
 * second parse of the note.
 *
 * These cases run against the Node isolate. The Web Worker isolate shares
 * `run-job.ts` verbatim (see its doc comment: that sharing is the whole
 * reason the module exists), so the listing cannot differ between hosts.
 */

const WORKER_PATH = path.join(__dirname, 'worker-entry.ts');

function fence(name: string, body: string): string {
  return '```lua {name=' + name + '}\n' + body + '\n```\n';
}

describe('doc probe (host) — a script reads the note it runs in', () => {
  it('lists the note own directives, in document order, through the real isolate', async () => {
    const text =
      ':::prep_q{q="First?" level=easy}\nBecause of this.\n:::\n\n' +
      ':::prep_q{q="Second?" level=hard}\nAnd because of that.\n:::\n\n' +
      '::prep_topic[Graphs]{confidence=4}\n\n' +
      fence(
        'quiz',
        `local out = {}
         for _, card in ipairs(doc.directives{ name = "prep_q" }) do
           out[#out + 1] = card.attributes.q .. "/" .. card.attributes.level .. "/" .. card.text
         end
         return { items = out, all = #doc.directives(), truncated = doc.truncated }`,
      );

    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 10_000,
      workerPath: WORKER_PATH,
    });

    expect(result.failures).toEqual([]);
    expect(result.values.quiz?.value).toEqual({
      items: [
        'First?/easy/Because of this.',
        'Second?/hard/And because of that.',
      ],
      all: 3,
      truncated: false,
    });
  });

  it('reads a value a script above produced, and refuses one from below', async () => {
    const text =
      fence('above', 'return { n = 3 }') +
      '\n' +
      fence('reader', 'return doc.value("above").n') +
      '\n' +
      fence('early', 'return doc.value("late")') +
      '\n' +
      fence('late', 'return 1');

    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 10_000,
      workerPath: WORKER_PATH,
    });

    expect(result.values.reader?.value).toBe(3);
    expect(result.values.late?.value).toBe(1);
    expect(result.failures).toEqual([
      {
        name: 'early',
        message: 'reads "late", which runs later in the note',
        kind: 'script-error',
      },
    ]);
    expect(result.values.early?.status).toBe('error');
    expect(result.values.early?.failureKind).toBe('script-error');
  });

  it('is available under a scheduled trigger, which grants no capability', async () => {
    const text =
      '::note{a=1}\n\n' +
      fence(
        'read',
        `return { n = #doc.directives(), a = doc.directives()[1].attributes.a,
                  net = tostring(net), bundle = tostring(bundle) }`,
      );

    const result = await spawnRun({
      text,
      trigger: 'scheduled',
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 10_000,
      workerPath: WORKER_PATH,
    });

    expect(result.failures).toEqual([]);
    expect(result.values.read?.value).toEqual({
      n: 1,
      a: '1',
      net: 'nil',
      bundle: 'nil',
    });
  });

  it('gives a note with no directives an empty list rather than a missing table', async () => {
    const text =
      '# Just prose\n\n' +
      fence(
        'read',
        'return { n = #doc.directives(), t = doc.truncated, v = tostring(doc.value("nothing")) }',
      );

    const result = await spawnRun({
      text,
      netAllowlist: [],
      cacheSnapshot: {},
      timeoutMs: 10_000,
      workerPath: WORKER_PATH,
    });

    expect(result.failures).toEqual([]);
    expect(result.values.read?.value).toEqual({ n: 0, t: false, v: 'nil' });
  });
});
