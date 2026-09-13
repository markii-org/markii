/**
 * Batch 11 Phase 3: runs the whole `conformance/host/` corpus through this
 * app's REAL `HostAdapter` (`./host-adapter.js`'s `createCliHostAdapter`),
 * wrapped in a fake terminal and an in-memory memento instead of a real
 * TTY and a real state file. The adapter's own logic is real: the TTY
 * check, the `y`/`n` parsing, the worker-path resolution fallback.
 *
 * This CLI declares no `editor` and no `packs` (AGENTS.md: "Loads no packs
 * by design"), so every completion/hover/insert/pack action in the corpus
 * is expected to come back as the shared `unsupported` record — see
 * `tmp/W11-phase3.md` for why that is the honest, correct answer here, not
 * a gap in this test.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Terminal } from './terminal.js';
import { createCliHostAdapter } from './host-adapter.js';
import { renderMarkToAnsi } from '@markii/ansi';
import {
  assertHostScenario,
  createAnswerQueue,
  hostConformanceDir,
  listHostScenarioNames,
  loadHostScenario,
  runHostScenario,
  type GrantMemento,
  type Thenable,
} from '@markii/host';

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

/**
 * A scripted, always-a-TTY terminal: `ask` answers from `queue`, in order,
 * and THROWS once it is exhausted — never a silent deny (the corpus's own
 * rule; see `conformance/host/README.md`).
 */
function createScriptedTerminal(queue: { next(): boolean }): Terminal {
  return {
    write(): void {},
    writeError(): void {},
    columns: 80,
    stdinIsTty: true,
    stdoutIsTty: false,
    env: {},
    async ask(): Promise<string> {
      return queue.next() ? 'y' : 'n';
    },
  };
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('conformance/host/ corpus via the real CLI HostAdapter', () => {
  for (const name of listHostScenarioNames(hostConformanceDir())) {
    it(`${name}: matches every capability this host declares`, async () => {
      const { dir, noteText, scenario, expected } = loadHostScenario(name);
      const queue = createAnswerQueue(scenario);
      const diagnosticsLines: string[] = [];
      // A real export write lands under a per-test temp directory, never
      // the repo working directory: `createCliHostAdapter` writes through
      // real `node:fs`, with no injectable writeFile seam.
      const exportDir = mkdtempSync(
        path.join(tmpdir(), 'markii-cli-host-conformance-'),
      );
      tempDirs.push(exportDir);
      const adapter = createCliHostAdapter({
        terminal: createScriptedTerminal(queue),
        memento: createMemoryMemento(),
        diagnostics: (line) => diagnosticsLines.push(line),
        now: () => scenario.clock,
        exportTarget: path.join(exportDir, 'export-output'),
      });

      const result = await runHostScenario(adapter, scenario, noteText, dir, {
        renderAnsi: (text) =>
          renderMarkToAnsi(text, undefined, undefined, undefined, {
            color: 'never',
            width: 80,
          }),
      });

      const problems = assertHostScenario(adapter, scenario, expected, result);
      expect(problems).toEqual([]);
    });
  }
});
