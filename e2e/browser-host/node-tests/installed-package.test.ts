/**
 * Runs from the INSTALLED tarballs, in Node, with no browser:
 * - every `conformance/host/` scenario against the fixture's own adapter
 *   over its in-memory file tree, through `@markii/host/conformance`;
 * - a Lua run through `createNodeHostIsolate()` from `@markii/host/node`
 *   with no worker path, so the packaged worker is the one that runs.
 *
 * Node strips the TypeScript types; run it with `npm run test:node`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { GrantMemento } from '@markii/host';
import {
  assertHostScenario,
  createAnswerQueue,
  hostConformanceDir,
  listHostScenarioNames,
  loadHostScenario,
  runHostScenario,
} from '@markii/host/conformance';
import { createNodeHostIsolate } from '@markii/host/node';
import { createFixtureHost } from '../src/host.ts';

function memoryMemento(): GrantMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) : defaultValue) as T;
    },
    update(key: string, value: unknown): Promise<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

const names = listHostScenarioNames(hostConformanceDir());

test('the packaged corpus lists scenarios', () => {
  assert.ok(names.length > 0);
});

for (const name of names) {
  test(`conformance/host/${name} against the fixture adapter`, async () => {
    const { dir, noteText, scenario, expected } = loadHostScenario(name);
    const queue = createAnswerQueue(scenario);
    const fixture = createFixtureHost({ ask: async () => queue.next() }, [], {
      memento: memoryMemento(),
    });
    // The adapter reads the note through its own file system.
    await fixture.fs.writeFile(
      path.join(dir, 'note.mk.md'),
      new TextEncoder().encode(noteText),
    );
    const result = await runHostScenario(
      fixture.adapter,
      scenario,
      noteText,
      dir,
      { archiveExtractFs: fixture.fs.asArchiveExtractFs() },
    );
    const problems = assertHostScenario(
      fixture.adapter,
      scenario,
      expected,
      result,
    );
    assert.deepEqual(problems, []);
  });
}

test('createNodeHostIsolate() runs a Lua script from the installed package', async () => {
  const fixture = createFixtureHost({ ask: undefined }, [], {
    memento: memoryMemento(),
    isolate: createNodeHostIsolate(),
  });
  const outcome = await fixture.host.run({
    documentKey: 'node-isolate-probe',
    text: '```lua {name=sum}\nreturn 1 + 1\n```\n',
    trigger: 'manual',
  });
  assert.equal(outcome.kind, 'ran');
  if (outcome.kind !== 'ran') return;
  assert.deepEqual(outcome.failures, []);
  assert.equal(outcome.values.sum?.value, 2);
});

/** Every module `entry` reaches through relative imports, and each bare specifier on the way. */
function importGraph(entryUrl: string): Set<string> {
  const bare = new Set<string>();
  const seen = new Set<string>();
  const queue = [fileURLToPath(entryUrl)];
  const pattern =
    /(?:^|\n)\s*(?:import|export)\s[^'"\n;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier === undefined) continue;
      if (specifier.startsWith('.')) {
        queue.push(path.resolve(path.dirname(file), specifier));
      } else {
        bare.add(specifier);
      }
    }
  }
  return bare;
}

test('@markii/host/node imports without the optional @markii/html or @markii/react peers', () => {
  const bare = importGraph(import.meta.resolve('@markii/host/node'));
  assert.ok(bare.has('node:fs/promises') || bare.has('node:fs'));
  const optional = [...bare].filter(
    (specifier) =>
      specifier === '@markii/html' ||
      specifier.startsWith('@markii/html/') ||
      specifier === '@markii/react' ||
      specifier.startsWith('@markii/react/'),
  );
  assert.deepEqual(optional, []);
});
