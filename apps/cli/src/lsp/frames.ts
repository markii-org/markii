/**
 * LSP base-protocol framing: `Content-Length: <n>\r\n\r\n<n bytes of JSON>`.
 * Hand-written (no LSP library). The parser takes arbitrary chunks (a frame
 * split anywhere, several frames in one chunk) and yields each complete
 * body. A malformed header block, a missing or oversized length, or a
 * body that is not valid UTF-8 JSON never throws: the parser reports a
 * `bad-frame` item and resynchronises past the damage.
 */

/** The largest body accepted, in bytes. A client announcing more is protocol abuse, not a document. */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export type FrameItem =
  | { readonly kind: 'message'; readonly value: unknown }
  | { readonly kind: 'bad-frame'; readonly reason: string };

const HEADER_END = Buffer.from('\r\n\r\n');

export interface FrameParser {
  /** Feeds the next bytes from the stream and returns every item they completed. */
  push(chunk: Uint8Array): FrameItem[];
}

function contentLength(header: string): number | undefined {
  for (const line of header.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== 'content-length')
      continue;
    const value = line.slice(colon + 1).trim();
    if (!/^[0-9]+$/.test(value)) return undefined;
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  return undefined;
}

export function createFrameParser(): FrameParser {
  let buffer: Buffer = Buffer.alloc(0);

  return {
    push(chunk: Uint8Array): FrameItem[] {
      buffer = Buffer.concat([buffer, chunk]);
      const items: FrameItem[] = [];
      for (;;) {
        const end = buffer.indexOf(HEADER_END);
        if (end === -1) {
          // No complete header yet. A header block that never ends is
          // dropped once it is clearly not one.
          if (buffer.length > 8192) {
            items.push({ kind: 'bad-frame', reason: 'header block too long' });
            buffer = Buffer.alloc(0);
          }
          return items;
        }
        const header = buffer.subarray(0, end).toString('latin1');
        const length = contentLength(header);
        if (length === undefined || length > MAX_FRAME_BYTES) {
          items.push({
            kind: 'bad-frame',
            reason:
              length === undefined
                ? 'missing or invalid Content-Length'
                : 'frame too large',
          });
          // Skip the damaged header block and look for the next one.
          buffer = buffer.subarray(end + HEADER_END.length);
          continue;
        }
        const bodyStart = end + HEADER_END.length;
        if (buffer.length < bodyStart + length) return items;
        const body = buffer.subarray(bodyStart, bodyStart + length);
        buffer = buffer.subarray(bodyStart + length);
        try {
          const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
          items.push({ kind: 'message', value: JSON.parse(text) as unknown });
        } catch {
          items.push({ kind: 'bad-frame', reason: 'body is not valid JSON' });
        }
      }
    },
  };
}

/** One JSON-RPC message as a wire frame. */
export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf-8');
  return Buffer.concat([
    Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'),
    body,
  ]);
}
