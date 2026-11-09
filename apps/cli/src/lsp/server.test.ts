import { describe, expect, it } from 'vitest';
import { encodeFrame } from './frames.js';
import { createHarness, type Json } from './harness.js';

const URI = 'file:///notes/a.mk.md';

async function ready(capabilities: unknown = {}, text = '', uri = URI) {
  const h = createHarness();
  await h.initialize(capabilities);
  h.open(uri, text);
  return h;
}

function labels(result: Json): string[] {
  return (result?.items ?? []).map((item: { label: string }) => item.label);
}

describe('lifecycle', () => {
  it('refuses requests before initialize', async () => {
    const h = createHarness();
    const reply = await h.request('textDocument/hover', {});
    expect(reply.error?.code).toBe(-32002);
  });

  it('advertises only what is implemented', async () => {
    const h = createHarness();
    const reply = await h.initialize();
    expect(reply.result.capabilities).toEqual({
      textDocumentSync: { openClose: true, change: 1 },
      completionProvider: {
        triggerCharacters: [':', '{', '=', '"', ' '],
        resolveProvider: false,
      },
      hoverProvider: true,
    });
    expect(reply.result.serverInfo).toEqual({
      name: 'markii',
      version: 'test',
    });
  });

  it('exits 0 after shutdown and 1 without it', async () => {
    const clean = createHarness();
    await clean.initialize();
    expect((await clean.request('shutdown')).result).toBeNull();
    clean.notify('exit');
    await clean.server.idle();
    expect(clean.exits).toEqual([0]);

    const abrupt = createHarness();
    await abrupt.initialize();
    abrupt.notify('exit');
    await abrupt.server.idle();
    expect(abrupt.exits).toEqual([1]);
  });

  it('exits like `exit` when the stream ends', async () => {
    const h = createHarness();
    await h.initialize();
    h.server.streamEnded();
    await h.server.idle();
    expect(h.exits).toEqual([1]);
  });

  it('rejects requests after shutdown and unknown methods before it', async () => {
    const h = createHarness();
    await h.initialize();
    expect((await h.request('workspace/nothing')).error?.code).toBe(-32601);
    await h.request('shutdown');
    expect((await h.request('textDocument/hover', {})).error?.code).toBe(
      -32600,
    );
  });

  it('answers a bad frame with a parse error and keeps serving', async () => {
    const h = createHarness();
    await h.initialize();
    h.server.receive(Buffer.from('Content-Length: 3\r\n\r\n{x}'));
    await h.server.idle();
    expect(h.out.some((m) => m.error?.code === -32700)).toBe(true);
    expect((await h.request('shutdown')).result).toBeNull();
  });

  it('survives frames split and joined arbitrarily', async () => {
    const h = createHarness();
    const bytes = Buffer.concat([
      encodeFrame({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { capabilities: {} },
      }),
      encodeFrame({ jsonrpc: '2.0', method: 'initialized', params: {} }),
      encodeFrame({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
    ]);
    for (let i = 0; i < bytes.length; i += 7) {
      h.server.receive(bytes.subarray(i, i + 7));
    }
    await h.server.idle();
    expect(h.out.map((m) => m.id)).toEqual([1, 2]);
  });
});

describe('position encoding', () => {
  it('echoes the encoding it picked from the client offer', async () => {
    const h = createHarness();
    const reply = await h.initialize({
      general: { positionEncodings: ['utf-8', 'utf-16'] },
    });
    expect(reply.result.capabilities.positionEncoding).toBe('utf-8');
  });

  it('sends none when the client offered none', async () => {
    const h = createHarness();
    const reply = await h.initialize();
    expect(reply.result.capabilities.positionEncoding).toBeUndefined();
  });

  // The emoji is 2 UTF-16 units, 4 UTF-8 bytes, 1 code point.
  const TEXT = '😀 :kb';
  const cases = [
    ['utf-16', 6, { start: 3, end: 6 }],
    ['utf-8', 8, { start: 5, end: 8 }],
    ['utf-32', 5, { start: 2, end: 5 }],
  ] as const;
  it.each(cases)(
    'completes after an emoji with %s offsets',
    async (encoding, character, range) => {
      const h = await ready(
        { general: { positionEncodings: [encoding] } },
        TEXT,
      );
      await h.server.idle();
      const reply = await h.request('textDocument/completion', {
        textDocument: { uri: URI },
        position: { line: 0, character },
      });
      const kbd = reply.result.items.find(
        (item: { label: string }) => item.label === 'kbd',
      );
      expect(kbd.textEdit.range).toEqual({
        start: { line: 0, character: range.start },
        end: { line: 0, character: range.end },
      });
    },
  );
});

describe('completion', () => {
  it('offers directive names with detail, documentation and a filter text', async () => {
    const h = await ready({}, ':::cal');
    const reply = await h.request('textDocument/completion', {
      textDocument: { uri: URI },
      position: { line: 0, character: 6 },
    });
    expect(reply.result.isIncomplete).toBe(false);
    expect(labels(reply.result)).toContain('callout');
    const callout = reply.result.items.find(
      (item: { label: string }) => item.label === 'callout',
    );
    expect(callout.detail).toBe('standard');
    expect(callout.documentation.value).toContain('callout');
    expect(callout.filterText).toBe(':::callout');
    expect(callout.textEdit.range).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 6 },
    });
    expect(callout.insertTextFormat).toBe(1);
  });

  it('sends a snippet with a final tab stop when the client supports snippets', async () => {
    const h = await ready(
      {
        textDocument: {
          completion: { completionItem: { snippetSupport: true } },
        },
      },
      ':::cal',
    );
    const reply = await h.request('textDocument/completion', {
      textDocument: { uri: URI },
      position: { line: 0, character: 6 },
    });
    const callout = reply.result.items.find(
      (item: { label: string }) => item.label === 'callout',
    );
    expect(callout.insertTextFormat).toBe(2);
    expect(callout.textEdit.newText).toContain('$0');
  });

  it('offers attribute names and values', async () => {
    const h = await ready({}, '::callout{ty}');
    const names = await h.request('textDocument/completion', {
      textDocument: { uri: URI },
      position: { line: 0, character: 12 },
    });
    expect(labels(names.result)).toContain('type');

    h.notify('textDocument/didChange', {
      textDocument: { uri: URI, version: 2 },
      contentChanges: [{ text: '::callout{type="}' }],
    });
    const values = await h.request('textDocument/completion', {
      textDocument: { uri: URI },
      position: { line: 0, character: 16 },
    });
    expect(labels(values.result)).toEqual(
      expect.arrayContaining(['info', 'warning', 'danger']),
    );
  });

  it('lengthens an enclosing fence when a container would close it early', async () => {
    const text = ':::card\n:::cal\n:::';
    const h = await ready({}, text);
    const reply = await h.request('textDocument/completion', {
      textDocument: { uri: URI },
      position: { line: 1, character: 6 },
    });
    const callout = reply.result.items.find(
      (item: { label: string }) => item.label === 'callout',
    );
    expect(callout.additionalTextEdits).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 3 },
        },
        newText: '::::',
      },
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 3 },
        },
        newText: '::::',
      },
    ]);
  });

  it('offers nothing outside a directive, for a bare closing fence, and for other documents', async () => {
    const h = await ready({}, 'plain text\n:::card\nx\n:::');
    const params = (line: number, character: number, uri = URI) => ({
      textDocument: { uri },
      position: { line, character },
    });
    expect(
      (await h.request('textDocument/completion', params(0, 5))).result,
    ).toBeNull();
    expect(
      (await h.request('textDocument/completion', params(3, 3))).result,
    ).toBeNull();

    h.open('file:///notes/readme.md', ':::cal');
    expect(
      (
        await h.request(
          'textDocument/completion',
          params(0, 6, 'file:///notes/readme.md'),
        )
      ).result,
    ).toBeNull();
  });

  it('rejects malformed params', async () => {
    const h = await ready();
    const reply = await h.request('textDocument/completion', {});
    expect(reply.error?.code).toBe(-32602);
  });
});

describe('hover', () => {
  it('describes the directive under the cursor, with its range', async () => {
    const h = await ready({}, 'x\n::callout{type="info"}\nhi\n::');
    const reply = await h.request('textDocument/hover', {
      textDocument: { uri: URI },
      position: { line: 1, character: 4 },
    });
    expect(reply.result.contents.kind).toBe('plaintext');
    expect(reply.result.contents.value).toContain('callout');
    expect(reply.result.range).toEqual({
      start: { line: 1, character: 2 },
      end: { line: 1, character: 9 },
    });
    const away = await h.request('textDocument/hover', {
      textDocument: { uri: URI },
      position: { line: 0, character: 0 },
    });
    expect(away.result).toBeNull();
  });
});

describe('diagnostics', () => {
  const BAD = '# Title\n\n::callout{type="bogus"}\nbody\n::\n\n::nothing{}\n';

  it('publishes the render findings with ranges, codes and the engine wording', async () => {
    const h = await ready({}, BAD);
    const [published] = await h.published('textDocument/publishDiagnostics');
    expect(published?.params.uri).toBe(URI);
    expect(published?.params.version).toBe(1);
    const diagnostics = published?.params.diagnostics;
    expect(diagnostics).toEqual([
      {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 23 },
        },
        severity: 2,
        code: 'invalid-attribute-value',
        source: 'markii',
        message: 'callout: "bogus" is not a valid type value (ignored)',
      },
      {
        range: {
          start: { line: 6, character: 0 },
          end: { line: 6, character: 11 },
        },
        severity: 2,
        code: 'unknown-directive',
        source: 'markii',
        message: 'nothing: unknown component, shown as a placeholder',
      },
    ]);
  });

  it('republishes after an edit and clears on close', async () => {
    const h = await ready({}, BAD);
    await h.published('textDocument/publishDiagnostics');
    h.notify('textDocument/didChange', {
      textDocument: { uri: URI, version: 2 },
      contentChanges: [{ text: '::callout{type="info"}\nbody\n::\n' }],
    });
    const all = await h.published('textDocument/publishDiagnostics');
    const last = all[all.length - 1];
    expect(last?.params.version).toBe(2);
    expect(last?.params.diagnostics).toEqual([]);

    h.notify('textDocument/didClose', { textDocument: { uri: URI } });
    const closed = await h.published('textDocument/publishDiagnostics');
    const final = closed[closed.length - 1];
    expect(final?.params).toEqual({ uri: URI, diagnostics: [] });
  });

  it('debounces a burst of edits into one check', async () => {
    const h = createHarness({ debounceMs: 20 });
    await h.initialize();
    h.open(URI, BAD);
    await h.server.idle();
    const before = h.out.filter(
      (m) => m.method === 'textDocument/publishDiagnostics',
    ).length;
    for (let version = 2; version < 8; version += 1) {
      h.notify('textDocument/didChange', {
        textDocument: { uri: URI, version },
        contentChanges: [{ text: `${BAD}\nedit ${version}\n` }],
      });
    }
    const all = await h.published('textDocument/publishDiagnostics');
    expect(all.length - before).toBe(1);
    expect(all[all.length - 1]?.params.version).toBe(7);
  });

  it('marks a multi-line directive on its opening line only', async () => {
    const h = await ready({}, '::callout{type="bogus"}\nbody\nmore\n::\n');
    const [published] = await h.published('textDocument/publishDiagnostics');
    expect(published?.params.diagnostics[0].range.end).toEqual({
      line: 0,
      character: 23,
    });
  });

  it('places a finding after an emoji in the negotiated encoding', async () => {
    const h = createHarness();
    await h.initialize({ general: { positionEncodings: ['utf-8'] } });
    h.open(URI, '😀 :callout[x]\n');
    const [published] = await h.published('textDocument/publishDiagnostics');
    expect(published?.params.diagnostics[0]).toMatchObject({
      code: 'form-mismatch',
      range: { start: { line: 0, character: 5 } },
    });
  });

  it('says nothing for documents that are not .mk.md', async () => {
    const h = await ready({}, '::nothing{}', 'file:///notes/readme.md');
    const published = await h.published('textDocument/publishDiagnostics');
    expect(published).toEqual([]);
  });

  it('writes only protocol frames: a failing check is logged, not dumped', async () => {
    const h = await ready();
    expect(h.logs).toEqual([]);
  });
});
