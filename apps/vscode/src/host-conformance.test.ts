/**
 * Batch 11 Phase 3/2b: runs the whole `conformance/host/` corpus through
 * this extension's REAL `HostAdapter` (`./host-adapter.js`'s
 * `createVSCodeHostAdapter`), wrapped in fake/temp-directory-backed
 * dependencies instead of real `vscode` objects — this module stays
 * `vscode`-free, exactly like `host-adapter.ts` itself.
 *
 * Phase 2b gave `createVSCodeHostAdapter` an `editor` capability, so this
 * test now supplies a fake in-memory editor (`fakeVscodeEditor` below)
 * instead of leaving `editor` absent: scenarios 07 (`completeAt`), 08
 * (`hoverAt`), and 09 (`insertComponent`) exercise the real
 * `completeAtViaEditor`/`hoverAtViaEditor`/`insertComponentPlan` path over
 * this host's adapter, the same way every other scenario already
 * exercises the real run/export/pack path.
 */
import { mkdtempSync, readFile, rmSync, writeFile } from 'node:fs';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createVSCodeHostAdapter } from './host-adapter.js';
import {
  assertHostScenario,
  createAnswerQueue,
  hostConformanceDir,
  listHostScenarioNames,
  loadHostScenario,
  runHostScenario,
  type GrantMemento,
  type HostTextEdit,
  type Thenable,
} from '@markii/host';

/**
 * A minimal in-memory stand-in for a `vscode.TextEditor`: mutable line
 * array, a fixed cursor at the end of the initial document (any position
 * is fine for these scenarios; none of them depend on where the cursor
 * starts), and `applyEdits` that mutates the buffer the same way VS
 * Code's real `editor.edit()` would, one line-indexed splice per edit,
 * processed in the array's own order — which `insertComponentPlan`
 * already guarantees is bottom-to-top, exactly what a plain by-index
 * splice (no re-parsing between edits) requires to stay correct.
 */
function fakeVscodeEditor(initialText: string) {
  let lines = initialText.split('\n');
  return {
    editorDocumentText: () => lines.join('\n'),
    editorDocumentPath: () => '/note.mk.md',
    editorCursor: () => ({ line: lines.length - 1, column: 0 }),
    editorApplyEdits: async (edits: readonly HostTextEdit[]) => {
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

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

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

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(
    path.join(tmpdir(), 'markii-vscode-host-conformance-'),
  );
  tempDirs.push(dir);
  return dir;
}

describe('conformance/host/ corpus via the real VS Code HostAdapter', () => {
  for (const name of listHostScenarioNames(hostConformanceDir())) {
    it(`${name}: matches every capability this host declares`, async () => {
      const { dir, noteText, scenario, expected } = loadHostScenario(name);
      const queue = createAnswerQueue(scenario);
      const installRoot = makeTempDir();
      const exportDir = makeTempDir();

      const adapter = createVSCodeHostAdapter({
        memento: createMemoryMemento(),
        prompt: async () => queue.next(),
        diagnostics: () => {},
        now: () => scenario.clock,
        workerPath: () => undefined,
        readFile: (p) => readFileAsync(p).then((b) => new Uint8Array(b)),
        exists: async (p) => {
          try {
            await access(p);
            return true;
          } catch {
            return false;
          }
        },
        writeFile: (p, bytes) => writeFileAsync(p, bytes),
        authorizedFolders: async () => [installRoot],
        installRoot: () => installRoot,
        exportFormats: new Set(['html']),
        resolveExportTarget: async (suggestedFileName) =>
          path.join(exportDir, suggestedFileName),
        ...fakeVscodeEditor(noteText),
      });

      const result = await runHostScenario(adapter, scenario, noteText, dir);
      const problems = assertHostScenario(adapter, scenario, expected, result);
      expect(problems).toEqual([]);
    });
  }
});
