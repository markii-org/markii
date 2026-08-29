import { describe, expect, it } from 'vitest';
import { decodeBase64 } from './decode-base64.js';

describe('decodeBase64', () => {
  it('round-trips real bytes', () => {
    const original = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255]);
    const base64 = Buffer.from(original).toString('base64');
    const decoded = decodeBase64(base64);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded ?? [])).toEqual(Array.from(original));
  });

  it('returns undefined for an empty string', () => {
    expect(decodeBase64('')).toBeUndefined();
  });

  it('returns undefined for malformed input', () => {
    // Not a valid base64 alphabet character sequence — `atob` throws on it.
    expect(decodeBase64('not-valid-base64!!!')).toBeUndefined();
  });

  it('preserves high bytes (>127) byte-exactly', () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;
    const base64 = Buffer.from(original).toString('base64');
    const decoded = decodeBase64(base64);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded ?? [])).toEqual(Array.from(original));
  });
});
