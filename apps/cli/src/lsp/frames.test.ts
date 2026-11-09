import { describe, expect, it } from 'vitest';
import { createFrameParser, encodeFrame, MAX_FRAME_BYTES } from './frames.js';

function messagesOf(
  items: ReturnType<ReturnType<typeof createFrameParser>['push']>,
) {
  return items.flatMap((item) => (item.kind === 'message' ? [item.value] : []));
}

describe('LSP framing', () => {
  it('round-trips a message', () => {
    const parser = createFrameParser();
    const items = parser.push(encodeFrame({ jsonrpc: '2.0', id: 1 }));
    expect(messagesOf(items)).toEqual([{ jsonrpc: '2.0', id: 1 }]);
  });

  it('counts the length in bytes, not characters', () => {
    const frame = encodeFrame({ text: 'héllo 😀' });
    const header = frame.subarray(0, frame.indexOf('\r\n')).toString('ascii');
    expect(header).toBe(
      `Content-Length: ${Buffer.byteLength('{"text":"héllo 😀"}')}`,
    );
  });

  it('joins a frame split at every possible byte', () => {
    const frame = encodeFrame({ text: 'héllo 😀 wörld' });
    for (let cut = 1; cut < frame.length; cut += 1) {
      const parser = createFrameParser();
      const first = parser.push(frame.subarray(0, cut));
      const second = parser.push(frame.subarray(cut));
      expect(messagesOf([...first, ...second])).toEqual([
        { text: 'héllo 😀 wörld' },
      ]);
    }
  });

  it('splits frames that arrive concatenated', () => {
    const parser = createFrameParser();
    const both = Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 })]);
    expect(messagesOf(parser.push(both))).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('accepts extra headers and any header case', () => {
    const parser = createFrameParser();
    const body = '{"ok":true}';
    const raw = `Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: ${body.length}\r\n\r\n${body}`;
    expect(messagesOf(parser.push(Buffer.from(raw)))).toEqual([{ ok: true }]);
  });

  it('reports a bad body and keeps reading', () => {
    const parser = createFrameParser();
    const bad = Buffer.from('Content-Length: 5\r\n\r\n{nope');
    const items = parser.push(Buffer.concat([bad, encodeFrame({ n: 3 })]));
    expect(items[0]).toEqual({
      kind: 'bad-frame',
      reason: 'body is not valid JSON',
    });
    expect(messagesOf(items)).toEqual([{ n: 3 }]);
  });

  it('reports a missing length and resynchronises past the header', () => {
    const parser = createFrameParser();
    const junk = Buffer.from('X-Nothing: 1\r\n\r\n');
    const items = parser.push(Buffer.concat([junk, encodeFrame({ n: 4 })]));
    expect(items[0]?.kind).toBe('bad-frame');
    expect(messagesOf(items)).toEqual([{ n: 4 }]);
  });

  it('refuses an absurd length instead of buffering it', () => {
    const parser = createFrameParser();
    const items = parser.push(
      Buffer.from(`Content-Length: ${MAX_FRAME_BYTES + 1}\r\n\r\n`),
    );
    expect(items).toEqual([{ kind: 'bad-frame', reason: 'frame too large' }]);
  });
});
