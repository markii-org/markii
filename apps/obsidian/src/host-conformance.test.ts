/**
 * Batch 11 Phase 3/2b: runs the whole `conformance/host/` corpus through
 * this plugin's REAL `HostAdapter` (`./host-adapter.js`'s
 * `createObsidianHostAdapter`), wrapped in an in-memory local-storage map
 * and temp-directory-backed pack/export capabilities instead of real
 * `obsidian` objects — this module stays `obsidian`-free, exactly like
 * `host-adapter.ts` itself (so it is not on
 * `src/obsidian-import-guard.test.ts`'s allowlist).
 *
 * Phase 2b gave `createObsidianHostAdapter` an `editor` capability, so this
 * test now supplies a fake in-memory editor (`fakeObsidianEditor` below)
 * instead of leaving `editor` absent: scenarios 07 (`completeAt`), 08
 * (`hoverAt`), and 09 (`insertComponent`) exercise the real
 * `completeAtViaEditor`/`hoverAtViaEditor`/`insertComponentPlan` path over
 * this host's adapter, the same way every other scenario already
 * exercises the real run/export/pack path.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createObsidianHostAdapter } from './host-adapter.js';
import {
  assertHostScenario,
  createAnswerQueue,
  hostConformanceDir,
  listHostScenarioNames,
  loadHostScenario,
  runHostScenario,
  type HostEditor,
  type HostTextEdit,
} from '@markii/host';

/**
 * A minimal in-memory stand-in for an Obsidian `Editor`, matching
 * `apps/vscode/src/host-conformance.test.ts`'s own `fakeVscodeEditor`: a
 * mutable line array, a fixed cursor at the end of the initial document,
 * and `applyEdits` that mutates the buffer with one line-indexed splice
 * per edit, in the array's own (bottom-to-top) order.
 */
function fakeObsidianEditor(initialText: string): HostEditor {
  let lines = initialText.split('\n');
  return {
    documentText: () => lines.join('\n'),
    documentPath: () => undefined,
    cursor: () => ({ line: lines.length - 1, column: 0 }),
    applyEdits: async (edits: readonly HostTextEdit[]) => {
      for (const edit of edits) {
        const line = lines[edit.line] ?? '';
        lines[edit.line] =
          line.slice(0, edit.startColumn) +
          edit.text +
          line.slice(edit.endColumn);
      }
      lines = lines.join('\n').split('\n');
      return true;
    },
  };
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(
    path.join(tmpdir(), 'markii-obsidian-host-conformance-'),
  );
  tempDirs.push(dir);
  return dir;
}

function createLocalStorage(): {
  load: (key: string) => unknown;
  save: (key: string, value: unknown) => void;
} {
  const store = new Map<string, unknown>();
  return {
    load: (key) => store.get(key),
    save: (key, value) => {
      store.set(key, value);
    },
  };
}

describe('conformance/host/ corpus via the real Obsidian HostAdapter', () => {
  for (const name of listHostScenarioNames(hostConformanceDir())) {
    it(`${name}: matches every capability this host declares`, async () => {
      const { dir, noteText, scenario, expected } = loadHostScenario(name);
      const queue = createAnswerQueue(scenario);
      const installRoot = makeTempDir();
      const exportDir = makeTempDir();
      const localStorage = createLocalStorage();

      const adapter = createObsidianHostAdapter({
        prompt: async () => queue.next(),
        loadLocalStorage: localStorage.load,
        saveLocalStorage: localStorage.save,
        diagnostics: () => {},
        now: () => scenario.clock,
        isolate: { kind: 'node', workerPath: () => undefined },
        packs: {
          authorizedFolders: async () => [installRoot],
          reservedNamespaces: () => new Set(['read', 'dash', 'prep']),
          installRoot: () => installRoot,
        },
        exports: {
          formats: new Set(['html']),
          resolveTarget: async (suggestedFileName) =>
            path.join(exportDir, suggestedFileName),
        },
        editor: fakeObsidianEditor(noteText),
      });

      const result = await runHostScenario(adapter, scenario, noteText, dir);
      const problems = assertHostScenario(adapter, scenario, expected, result);
      expect(problems).toEqual([]);
    });
  }
});
