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
import { CLI_LABELS } from './labels.js';
import type { GrantMemento, Thenable } from '../run/grant-flow.js';
import type { HostAdapter, HostPromptRequest } from './adapter.js';
import {
  ACTION_CAPABILITY,
  assertHostScenario,
  containsInOrder,
  createAnswerQueue,
  hostDeclaresCapability,
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
    isolate: { kind: 'node', workerPath: () => undefined },
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
        authorizedFolders: async () => [],
        reservedNamespaces: () => new Set(),
        installRoot: () => installRoot,
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
