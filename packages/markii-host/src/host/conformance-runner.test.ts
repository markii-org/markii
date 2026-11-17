import { devWorkerIsolate } from '../dev-isolate.js';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI_LABELS } from './labels.fixture.js';
import type { GrantMemento, Thenable } from '../run/grant-flow.js';
import type { HostAdapter, HostPromptRequest } from './adapter.js';
import {
  ACTION_CAPABILITY,
  assertHostScenario,
  containsInOrder,
  createAnswerQueue,
  expectedForLabels,
  fillLabelPlaceholders,
  hostDeclaresCapability,
  listHostScenarioNames,
  loadHostScenario,
  outcomeMismatches,
  runHostScenario,
  zipArchiveDirectory,
  type HostScenario,
} from './conformance-runner.js';

function createMemoryMemento(): GrantMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return store.has(key) ? (store.get(key) as T) : (defaultValue as T);
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

function fakeAdapter(overrides: Partial<HostAdapter> = {}): HostAdapter {
  return {
    id: 'cli',
    labels: CLI_LABELS,
    readFile: async () => new Uint8Array(),
    exists: async () => false,
    writeFile: async () => {},
    listFolder: async () => [],
    prompt: async () => false,
    memento: createMemoryMemento(),
    diagnostics: () => {},
    now: () => 1_000,
    isolate: {
      kind: 'node',
      workerPath: () => '/worker.js',
      spawnIsolate: devWorkerIsolate,
    },
    ...overrides,
  };
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeScenarioDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'markii-host-scenario-'));
  tempDirs.push(dir);
  return dir;
}

describe('ACTION_CAPABILITY / hostDeclaresCapability', () => {
  it('maps every action type to the capability it needs, or undefined for one always supported', () => {
    expect(ACTION_CAPABILITY.open).toBeUndefined();
    expect(ACTION_CAPABILITY.run).toBe('isolate');
    expect(ACTION_CAPABILITY.installPack).toBe('packs');
    expect(ACTION_CAPABILITY.loadPacks).toBe('packs');
    expect(ACTION_CAPABILITY.completeAt).toBe('editor');
    expect(ACTION_CAPABILITY.hoverAt).toBe('editor');
    expect(ACTION_CAPABILITY.insertComponent).toBe('editor');
    expect(ACTION_CAPABILITY.exportHtml).toBe('export-format');
    expect(ACTION_CAPABILITY.exportAnsi).toBe('export-format');
  });

  it('never consults the scenario, only the adapter under test', () => {
    const withIsolate = fakeAdapter();
    const withoutIsolate = fakeAdapter({ isolate: undefined });
    expect(
      hostDeclaresCapability(withIsolate, { type: 'run', trigger: 'manual' }),
    ).toBe(true);
    expect(
      hostDeclaresCapability(withoutIsolate, {
        type: 'run',
        trigger: 'manual',
      }),
    ).toBe(false);
    expect(
      hostDeclaresCapability(withIsolate, {
        type: 'completeAt',
        line: 0,
        column: 0,
      }),
    ).toBe(false);
  });

  it('installPack additionally requires an installRoot on the packs capability', () => {
    const noInstallRoot = fakeAdapter({
      packs: {
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(),
      },
    });
    expect(
      hostDeclaresCapability(noInstallRoot, {
        type: 'installPack',
        archive: 'x',
      }),
    ).toBe(false);
    expect(hostDeclaresCapability(noInstallRoot, { type: 'loadPacks' })).toBe(
      true,
    );
  });
});

describe('createAnswerQueue', () => {
  it('flattens run and installPack answers, in document order', () => {
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 0,
      actions: [
        { type: 'run', trigger: 'manual', answers: ['allow'] },
        { type: 'installPack', archive: 'files/a', answers: ['deny', 'allow'] },
      ],
    };
    const queue = createAnswerQueue(scenario);
    expect(queue.next()).toBe(true);
    expect(queue.next()).toBe(false);
    expect(queue.next()).toBe(true);
  });

  it('throws, never silently denies, once exhausted', () => {
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 0,
      actions: [{ type: 'run', trigger: 'manual', answers: [] }],
    };
    const queue = createAnswerQueue(scenario);
    expect(() => queue.next()).toThrow(/exhausted/);
  });
});

describe('runHostScenario: run', () => {
  it('reports a successful, simulated run when the note grants the requested host', async () => {
    const dir = makeScenarioDir();
    writeFileSync(
      path.join(dir, 'note.mk.md'),
      '```lua {name=total}\nreturn net.fetch_json("https://api.example.com/x")\n```\n',
    );
    const seen: HostPromptRequest[] = [];
    const adapter = fakeAdapter({
      prompt: async (request) => {
        seen.push(request);
        return true;
      },
    });
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 42,
      actions: [
        {
          type: 'run',
          trigger: 'manual',
          answers: ['allow'],
          simulate: {
            name: 'total',
            value: 7,
            requiresHost: 'api.example.com',
          },
        },
      ],
    };
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    expect(result.promptQueueError).toBeUndefined();
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toContain('api.example.com');
    const outcome = result.outcomes[0] as {
      kind: string;
      values: Record<string, { status: string; value: unknown }>;
    };
    expect(outcome.kind).toBe('ran');
    expect(outcome.values['total']?.value).toBe(7);
  });

  it('reports capability-denied when the grant is refused', async () => {
    const dir = makeScenarioDir();
    writeFileSync(
      path.join(dir, 'note.mk.md'),
      '```lua {name=total}\nreturn net.fetch_json("https://api.example.com/x")\n```\n',
    );
    const adapter = fakeAdapter({ prompt: async () => false });
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 1,
      actions: [
        {
          type: 'run',
          trigger: 'manual',
          answers: ['deny'],
          simulate: { name: 'total', requiresHost: 'api.example.com' },
        },
      ],
    };
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    const outcome = result.outcomes[0] as { failures: { kind: string }[] };
    expect(outcome.failures[0]?.kind).toBe('capability-denied');
  });

  it('reports tier-blocked for a simulated write under a non-manual trigger, without any prompt', async () => {
    const dir = makeScenarioDir();
    writeFileSync(
      path.join(dir, 'note.mk.md'),
      '```lua {name=w}\nreturn 1\n```\n',
    );
    const seen: HostPromptRequest[] = [];
    const adapter = fakeAdapter({
      prompt: async (request) => {
        seen.push(request);
        return true;
      },
    });
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 1,
      actions: [
        {
          type: 'run',
          trigger: 'auto',
          simulate: { name: 'w', requiresManualTier: true },
        },
      ],
    };
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    expect(seen).toHaveLength(0);
    const outcome = result.outcomes[0] as { failures: { kind: string }[] };
    expect(outcome.failures[0]?.kind).toBe('tier-blocked');
  });

  it('never reaches the isolate for a scripts-disabled run, and reports on both surfaces', async () => {
    const dir = makeScenarioDir();
    writeFileSync(
      path.join(dir, 'note.mk.md'),
      '```lua {name=total}\nreturn 1\n```\n',
    );
    const lines: string[] = [];
    const adapter = fakeAdapter({
      diagnostics: (line) => lines.push(line),
      // A prompt call here would mean the isolate path was reached.
      prompt: async () => {
        throw new Error('must not prompt when scripts are disabled');
      },
      isolate: {
        kind: 'node',
        spawnIsolate: devWorkerIsolate,
        workerPath: () => {
          throw new Error(
            'must not build a worker path when scripts are disabled',
          );
        },
      },
    });
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 1,
      actions: [{ type: 'run', trigger: 'manual', scriptsDisabled: true }],
    };
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    expect(result.promptQueueError).toBeUndefined();
    const outcome = result.outcomes[0] as { kind: string; reason: string };
    expect(outcome.kind).toBe('declined');
    expect(outcome.reason).toContain('script execution is off');
    expect(lines.some((l) => l.includes('run (manual) blocked'))).toBe(true);
  });
});

describe('runHostScenario: exportHtml', () => {
  it('captures the written file content for contains/excludes diffing', async () => {
    const dir = makeScenarioDir();
    writeFileSync(
      path.join(dir, 'note.mk.md'),
      '# hello\n\n::ana_timeline\n::\n',
    );
    const written = new Map<string, Uint8Array>();
    const adapter = fakeAdapter({
      exists: async () => false,
      writeFile: async (p, bytes) => {
        written.set(p, bytes);
      },
      exports: {
        formats: new Set(['html']),
        resolveTarget: async (name) => path.join(dir, name),
      },
    });
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 1,
      actions: [{ type: 'exportHtml' }],
    };
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    const outcome = result.outcomes[0] as { kind: string; content: string };
    expect(outcome.kind).toBe('exported');
    expect(outcome.content).toContain('mk-unknown');
    expect(outcome.content).toContain('ana_timeline');
    expect(outcome.content).not.toContain('<script');
  });
});

describe('runHostScenario: exportLinkedSet', () => {
  it('walks the notes the root links to and reports the archive entries', async () => {
    const dir = makeScenarioDir();
    writeFileSync(
      path.join(dir, 'note.mk.md'),
      '# root\n\n[second](files/second.mk.md)\n',
    );
    mkdirSync(path.join(dir, 'files'), { recursive: true });
    writeFileSync(path.join(dir, 'files', 'second.mk.md'), '# second\n');
    const written = new Map<string, Uint8Array>();
    const adapter = fakeAdapter({
      readFile: async (p) => new Uint8Array(readFileSync(p)),
      writeFile: async (p, bytes) => {
        written.set(p, bytes);
      },
      exports: {
        formats: new Set(),
        resolveTarget: async () => undefined,
        resolveLinkedSetTarget: async (name) => path.join(dir, name),
      },
    });
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 1,
      actions: [{ type: 'exportLinkedSet' }],
    };
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    const outcome = result.outcomes[0] as {
      kind: string;
      noteCount: number;
      entries: string[];
    };
    expect(outcome.kind).toBe('exported');
    expect(outcome.noteCount).toBe(2);
    expect(outcome.entries).toEqual(['index.html', 'note.html', 'second.html']);
  });

  it('is unsupported on an adapter with no linked-set target', async () => {
    const dir = makeScenarioDir();
    writeFileSync(path.join(dir, 'note.mk.md'), '# root\n');
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 1,
      actions: [{ type: 'exportLinkedSet' }],
    };
    const adapter = fakeAdapter();
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    expect(result.outcomes[0]).toMatchObject({
      kind: 'unsupported',
      capability: 'linked-set-export',
    });
    expect(hostDeclaresCapability(adapter, scenario.actions[0]!)).toBe(false);
  });
});

describe('runHostScenario: installPack', () => {
  it('zips a files/ directory into archive bytes and installs it', async () => {
    const dir = makeScenarioDir();
    writeFileSync(path.join(dir, 'note.mk.md'), '# n\n');
    const archiveDir = path.join(dir, 'files', 'ana-1.0.0');
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      path.join(archiveDir, 'pack.json'),
      JSON.stringify({ name: 'ana', engine: 'react', components: {} }),
    );
    writeFileSync(
      path.join(archiveDir, 'webview.js'),
      'window.__markiiRegisterPack(() => ({}));',
    );

    const installRoot = path.join(dir, 'installed');
    const adapter = fakeAdapter({
      prompt: async () => true,
      exists: async () => false,
      writeFile: async () => {},
      packs: {
        trust: 'none',
        engine: 'react',
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(),
        installRoot: () => installRoot,
        removeFolder: async () => {},
      },
    });
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 1,
      actions: [
        { type: 'installPack', archive: 'files/ana-1.0.0', answers: ['allow'] },
      ],
    };
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    const outcome = result.outcomes[0] as { kind: string; namespace: string };
    expect(outcome.kind).toBe('installed');
    expect(outcome.namespace).toBe('ana');
  });
});

describe('zipArchiveDirectory', () => {
  it('produces bytes openPackArchive-shaped content can be extracted from', () => {
    const dir = makeScenarioDir();
    const archiveDir = path.join(dir, 'a');
    mkdirSync(path.join(archiveDir, 'scripts'), { recursive: true });
    writeFileSync(path.join(archiveDir, 'pack.json'), '{}');
    writeFileSync(path.join(archiveDir, 'scripts', 'x.lua'), 'return 1');
    const bytes = zipArchiveDirectory(archiveDir);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe('containsInOrder / outcomeMismatches', () => {
  it('reports a count mismatch as one problem, not one per missing index', () => {
    expect(containsInOrder(['a'], ['a', 'b'])).toHaveLength(1);
  });

  it('matches by substring, in order', () => {
    expect(containsInOrder(['hello world'], ['world'])).toEqual([]);
  });

  it('kind mismatch short-circuits the rest of the comparison', () => {
    expect(outcomeMismatches({ kind: 'ran' }, { kind: 'exported' })).toEqual([
      'kind: expected "exported", got "ran"',
    ]);
  });

  it('an undefined expected entry never reports a mismatch', () => {
    expect(outcomeMismatches({ kind: 'opened' }, undefined)).toEqual([]);
  });
});

describe('assertHostScenario', () => {
  it('accepts the shared unsupported record for a capability the adapter never declares', async () => {
    const dir = makeScenarioDir();
    writeFileSync(path.join(dir, 'note.mk.md'), '# n\n');
    const adapter = fakeAdapter({ isolate: undefined });
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 1,
      actions: [{ type: 'run', trigger: 'manual' }],
    };
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    const problems = assertHostScenario(
      adapter,
      scenario,
      {
        outcomes: [{ kind: 'ran', values: { total: 1 } }],
        diagnostics: [],
        prompts: [],
      },
      result,
    );
    expect(problems).toEqual([]);
  });

  it('flags a capable host whose outcome does not match expected.json', async () => {
    const dir = makeScenarioDir();
    writeFileSync(path.join(dir, 'note.mk.md'), '# n\n');
    const adapter = fakeAdapter();
    const scenario: HostScenario = {
      id: 's',
      invariant: 'x',
      clock: 1,
      actions: [
        {
          type: 'run',
          trigger: 'manual',
          simulate: { name: 'total', value: 1 },
        },
      ],
    };
    const result = await runHostScenario(adapter, scenario, readNote(dir), dir);
    const problems = assertHostScenario(
      adapter,
      scenario,
      {
        outcomes: [{ kind: 'ran', values: { total: 999 } }],
        diagnostics: [],
        prompts: [],
      },
      result,
    );
    expect(problems.length).toBeGreaterThan(0);
  });
});

function readNote(dir: string): string {
  return readFileSync(path.join(dir, 'note.mk.md'), 'utf8');
}

describe('label placeholders in the corpus', () => {
  it('fills each noun from the labels and leaves unknown brace text alone', () => {
    const labels = { ...CLI_LABELS, noteNoun: 'page' };
    expect(
      fillLabelPlaceholders(
        '{appNoun}|{previewNoun}|{diagnosticsSurface}|{deviceNoun}|{noteNoun}|{other}|{settingName}',
        labels,
      ),
    ).toBe(
      'command line tool|the rendered note|stderr|this device|page|{other}|{settingName}',
    );
  });

  it('reads note when the host sets no note noun', () => {
    expect(fillLabelPlaceholders('{noteNoun}', CLI_LABELS)).toBe('note');
  });

  it('never fills a name that only exists on Object.prototype', () => {
    expect(fillLabelPlaceholders('{constructor}', CLI_LABELS)).toBe(
      '{constructor}',
    );
  });

  it('pins the default-label sentences of the corpus, byte for byte', () => {
    const prompts = (name: string): readonly string[] =>
      expectedForLabels(loadHostScenario(name).expected, CLI_LABELS).prompts;
    const diagnostics = (name: string): readonly string[] =>
      expectedForLabels(loadHostScenario(name).expected, CLI_LABELS)
        .diagnostics;
    expect(prompts('02-run-manual-grant-accepted')).toEqual([
      "This note's scripts can send data to api.example.com. Allow?",
    ]);
    expect(prompts('18-last-run-and-grants')).toEqual([
      "This note's scripts can send data to api.example.com. Allow?",
      "This note's scripts can send data to api.example.com. Allow?",
    ]);
    expect(diagnostics('10-scripts-disabled')).toEqual([
      'run (manual) blocked: script execution is off on this device',
    ]);
    expect(diagnostics('16-pack-trust')).toContain(
      'Pack "sneaky" is present but not enabled on this device; it was not loaded.',
    );
  });

  it('follows a host that names its note and its device differently', () => {
    const labels = {
      ...CLI_LABELS,
      noteNoun: 'page',
      deviceNoun: 'this workspace',
    };
    const filled = expectedForLabels(
      loadHostScenario('02-run-manual-grant-accepted').expected,
      labels,
    );
    expect(filled.prompts).toEqual([
      "This page's scripts can send data to api.example.com. Allow?",
    ]);
    expect(
      expectedForLabels(
        loadHostScenario('10-scripts-disabled').expected,
        labels,
      ).diagnostics,
    ).toEqual([
      'run (manual) blocked: script execution is off on this workspace',
    ]);
  });

  it('leaves no raw placeholder behind for the default labels', () => {
    for (const name of listHostScenarioNames()) {
      const filled = JSON.stringify(
        expectedForLabels(loadHostScenario(name).expected, CLI_LABELS),
      );
      expect(filled).not.toMatch(
        /\{(?:appNoun|previewNoun|diagnosticsSurface|deviceNoun|noteNoun)\}/,
      );
    }
  });
});

describe('a host with no pack install destination', () => {
  const installScenarios = [
    '06-install-pack-then-render',
    '13-install-pack-declined',
    '14-remove-pack',
    '15-load-packs-engine-views',
  ];

  for (const name of installScenarios) {
    it(`reports ${name} as unsupported and passes`, async () => {
      const { dir, noteText, scenario, expected } = loadHostScenario(name);
      const adapter = fakeAdapter({
        packs: {
          trust: 'none',
          engine: 'react',
          authorizedFolders: async () => [],
          reservedNamespaces: () => new Set(),
        },
      });
      const result = await runHostScenario(adapter, scenario, noteText, dir);
      expect(assertHostScenario(adapter, scenario, expected, result)).toEqual(
        [],
      );
      const kinds = result.outcomes.map(
        (outcome) => (outcome as { kind: string }).kind,
      );
      expect(kinds).toContain('unsupported');
    });
  }
});
