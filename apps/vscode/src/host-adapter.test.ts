import { describe, expect, it, vi } from 'vitest';
import { VSCODE_LABELS } from '@markii/host';
import { createVSCodeHostAdapter } from './host-adapter.js';

function fakeMemento() {
  const store = new Map<string, unknown>();
  return {
    get: (key: string, defaultValue?: unknown) =>
      store.has(key) ? store.get(key) : defaultValue,
    update: async (key: string, value: unknown) => {
      store.set(key, value);
    },
  };
}

describe('createVSCodeHostAdapter', () => {
  it('is built entirely from injected dependencies, with no vscode import', () => {
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: async () => true,
      diagnostics: vi.fn(),
    });
    expect(adapter.id).toBe('vscode');
    expect(adapter.labels).toBe(VSCODE_LABELS);
  });

  // Reporting "no built worker here" is this adapter's whole job in a
  // development or test run: which fallback applies then belongs to the
  // shared run path, so this host does not have to know one exists.
  it('reports an undefined worker path when none is injected, leaving the fallback to the shared run path', () => {
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: async () => true,
      diagnostics: vi.fn(),
      workerPath: () => undefined,
    });
    expect(adapter.isolate?.kind).toBe('node');
    expect(
      adapter.isolate?.kind === 'node'
        ? adapter.isolate.workerPath()
        : 'unreachable',
    ).toBeUndefined();
  });

  it('uses the injected workerPath when it resolves to a real path', () => {
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: async () => true,
      diagnostics: vi.fn(),
      workerPath: () => '/dist/run/worker.js',
    });
    expect(
      adapter.isolate?.kind === 'node' ? adapter.isolate.workerPath() : '',
    ).toBe('/dist/run/worker.js');
  });

  it('omits the packs capability when authorizedFolders is not injected', () => {
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: async () => true,
      diagnostics: vi.fn(),
    });
    expect(adapter.packs).toBeUndefined();
  });

  it('offers the packs capability, with an empty reserved-namespace set, once authorizedFolders is injected', async () => {
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: async () => true,
      diagnostics: vi.fn(),
      authorizedFolders: async () => ['/a', '/b'],
      installRoot: () => '/installed-packs',
    });
    expect(await adapter.packs?.authorizedFolders()).toEqual(['/a', '/b']);
    expect(adapter.packs?.reservedNamespaces()).toEqual(new Set());
    expect(adapter.packs?.installRoot?.()).toBe('/installed-packs');
  });

  it('omits the exports capability unless both formats and resolveTarget are injected', () => {
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: async () => true,
      diagnostics: vi.fn(),
      exportFormats: new Set(['html']),
    });
    expect(adapter.exports).toBeUndefined();
  });

  it('omits the editor capability unless documentText, cursor, and applyEdits are all injected', () => {
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: async () => true,
      diagnostics: vi.fn(),
      editorDocumentText: () => ':::callout',
    });
    expect(adapter.editor).toBeUndefined();
  });

  it('offers the editor capability once documentText, cursor, and applyEdits are injected', async () => {
    const applied: unknown[] = [];
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: async () => true,
      diagnostics: vi.fn(),
      editorDocumentText: () => ':::callout',
      editorDocumentPath: () => '/note.mk.md',
      editorCursor: () => ({ line: 0, column: 5 }),
      editorApplyEdits: async (edits) => {
        applied.push(edits);
        return true;
      },
    });
    expect(adapter.editor?.documentText()).toBe(':::callout');
    expect(adapter.editor?.documentPath()).toBe('/note.mk.md');
    expect(adapter.editor?.cursor()).toEqual({ line: 0, column: 5 });
    await expect(adapter.editor?.applyEdits([])).resolves.toBe(true);
    expect(applied).toHaveLength(1);
  });

  it('defaults documentPath to undefined when not injected', () => {
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: async () => true,
      diagnostics: vi.fn(),
      editorDocumentText: () => '',
      editorCursor: () => ({ line: 0, column: 0 }),
      editorApplyEdits: async () => true,
    });
    expect(adapter.editor?.documentPath()).toBeUndefined();
  });

  it('routes prompt and diagnostics straight through to the injected closures', async () => {
    const promptSpy = vi.fn(async () => false);
    const diagnosticsSpy = vi.fn();
    const adapter = createVSCodeHostAdapter({
      memento: fakeMemento(),
      prompt: promptSpy,
      diagnostics: diagnosticsSpy,
    });
    const answer = await adapter.prompt({
      kind: 'grant-host',
      message: 'm',
      allowLabel: 'Allow',
      denyLabel: 'Deny',
      consequential: true,
    });
    expect(answer).toBe(false);
    expect(promptSpy).toHaveBeenCalledOnce();
    adapter.diagnostics('a line');
    expect(diagnosticsSpy).toHaveBeenCalledWith('a line');
  });
});
