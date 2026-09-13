import { describe, expect, it } from 'vitest';
import {
  buildNoteHtmlExport,
  createMarkiiHost,
  mdPlainFromSource,
  type GrantMemento,
  type Thenable,
} from '@markii/host';
import { createCliHostAdapter } from './host-adapter.js';
import { createFakeTerminal } from './test-terminal.js';

/** A plain in-memory `GrantMemento`, matching every real adapter's device-local store shape. */
function fakeMemento(): GrantMemento {
  const store = new Map<string, unknown>();
  return {
    get<T>(key: string, defaultValue?: T): T {
      return (store.has(key) ? store.get(key) : defaultValue) as T;
    },
    update(key: string, value: unknown): Thenable<void> {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

describe('createCliHostAdapter: prompt', () => {
  it('with no TTY, denies without asking and reports the reason exactly once', async () => {
    const terminal = createFakeTerminal({ stdinIsTty: false });
    const lines: string[] = [];
    const adapter = createCliHostAdapter({
      terminal,
      memento: fakeMemento(),
      diagnostics: (line) => lines.push(line),
    });

    const first = await adapter.prompt({
      kind: 'grant-host',
      message: 'Allow example.com?',
      allowLabel: 'Allow',
      denyLabel: "Don't allow",
      consequential: true,
    });
    const second = await adapter.prompt({
      kind: 'grant-unknown-hosts',
      message: 'Allow any host?',
      allowLabel: 'Allow',
      denyLabel: "Don't allow",
      consequential: true,
    });

    expect(first).toBe(false);
    expect(second).toBe(false);
    expect(terminal.askedQuestions).toEqual([]);
    expect(lines).toEqual([
      'A grant cannot be given non-interactively; run markii in a terminal to allow network access.',
    ]);
  });

  it('with a TTY, asks the exact message and reads y/N', async () => {
    const terminal = createFakeTerminal({
      stdinIsTty: true,
      askAnswers: ['y', 'no'],
    });
    const adapter = createCliHostAdapter({ terminal, memento: fakeMemento() });

    const allowed = await adapter.prompt({
      kind: 'grant-host',
      message: 'Allow example.com?',
      allowLabel: 'Allow',
      denyLabel: "Don't allow",
      consequential: true,
    });
    const denied = await adapter.prompt({
      kind: 'grant-host',
      message: 'Allow other.com?',
      allowLabel: 'Allow',
      denyLabel: "Don't allow",
      consequential: true,
    });

    expect(allowed).toBe(true);
    expect(denied).toBe(false);
    expect(terminal.askedQuestions).toEqual([
      'Allow example.com? [y/N] ',
      'Allow other.com? [y/N] ',
    ]);
  });
});

describe('createCliHostAdapter: capabilities declared', () => {
  it('declares isolate and exports, but not editor or packs', () => {
    const adapter = createCliHostAdapter({
      terminal: createFakeTerminal(),
      memento: fakeMemento(),
    });
    expect(adapter.isolate).toBeDefined();
    expect(adapter.exports).toBeDefined();
    expect(adapter.exports?.formats).toEqual(
      new Set(['html', 'ansi', 'md-plain']),
    );
    expect(adapter.editor).toBeUndefined();
    expect(adapter.packs).toBeUndefined();
  });
});

describe('createMarkiiHost(createCliHostAdapter(...)).exportNote', () => {
  it('exports html byte for byte the same as buildNoteHtmlExport', async () => {
    const text = '# Hello\n\nSome *text*.\n';
    const notePath = 'note.mk.md';
    let written: Uint8Array | undefined;
    const adapter = createCliHostAdapter({
      terminal: createFakeTerminal(),
      memento: fakeMemento(),
      exportTarget: 'out.html',
    });
    const host = createMarkiiHost({
      ...adapter,
      writeFile: async (_path, bytes) => {
        written = bytes;
      },
    });

    const outcome = await host.exportNote({ format: 'html', notePath, text });

    expect(outcome.kind).toBe('exported');
    const expected = buildNoteHtmlExport({ text, fileName: notePath });
    expect(new TextDecoder().decode(written)).toBe(expected);
  });

  it('exports md-plain through the same rewrite @markii/host exposes directly', async () => {
    const text = 'Before.\n\n::divider\n\nAfter.\n';
    let written: Uint8Array | undefined;
    const adapter = createCliHostAdapter({
      terminal: createFakeTerminal(),
      memento: fakeMemento(),
      exportTarget: 'out.md',
    });
    const host = createMarkiiHost({
      ...adapter,
      writeFile: async (_path, bytes) => {
        written = bytes;
      },
    });

    const outcome = await host.exportNote({
      format: 'md-plain',
      notePath: 'note.mk.md',
      text,
    });

    expect(outcome.kind).toBe('exported');
    expect(new TextDecoder().decode(written)).toBe(mdPlainFromSource(text));
  });

  it('exports ansi through an injected renderer, writing to the adapter-resolved target', async () => {
    let written: Uint8Array | undefined;
    let writtenPath: string | undefined;
    const adapter = createCliHostAdapter({
      terminal: createFakeTerminal(),
      memento: fakeMemento(),
      exportTarget: 'out.txt',
    });
    const host = createMarkiiHost(
      {
        ...adapter,
        writeFile: async (path, bytes) => {
          writtenPath = path;
          written = bytes;
        },
      },
      { renderAnsi: async (text) => `rendered: ${text}` },
    );

    const outcome = await host.exportNote({
      format: 'ansi',
      notePath: 'note.mk.md',
      text: 'Hello.\n',
    });

    expect(outcome.kind).toBe('exported');
    expect(writtenPath).toBe('out.txt');
    expect(new TextDecoder().decode(written)).toBe('rendered: Hello.\n');
  });

  it('declines pdf: this adapter never declares it', async () => {
    const adapter = createCliHostAdapter({
      terminal: createFakeTerminal(),
      memento: fakeMemento(),
      exportTarget: 'out.pdf',
    });
    const host = createMarkiiHost(adapter);

    const outcome = await host.exportNote({
      format: 'pdf',
      notePath: 'note.mk.md',
      text: '# Hi\n',
    });

    expect(outcome.kind).toBe('unsupported');
  });
});

describe('createMarkiiHost(createCliHostAdapter(...)) with no packs/editor declared', () => {
  it('installPack, loadPacks, completeAt, hoverAt, and insertComponent all report unsupported, never a silent no-op', async () => {
    const adapter = createCliHostAdapter({
      terminal: createFakeTerminal(),
      memento: fakeMemento(),
    });
    const lines: string[] = [];
    const host = createMarkiiHost({
      ...adapter,
      diagnostics: (line) => lines.push(line),
    });

    const install = await host.installPack({ archiveBytes: new Uint8Array() });
    const load = await host.loadPacks();
    const complete = await host.completeAt({ line: 0, column: 0 });
    const hover = await host.hoverAt({ line: 0, column: 0 });
    const insert = await host.insertComponent({ name: 'callout' });

    expect(install.kind).toBe('unsupported');
    expect(load.kind).toBe('unsupported');
    expect(complete.kind).toBe('unsupported');
    expect(hover.kind).toBe('unsupported');
    expect(insert.kind).toBe('unsupported');
    // Every decline still reaches the diagnostics surface (AGENTS.md:
    // "clean is not silent").
    expect(lines.length).toBe(5);
  });
});
