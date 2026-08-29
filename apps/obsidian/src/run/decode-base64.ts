/**
 * Decodes a base64 string into raw bytes for `browser-worker.ts`'s blob
 * URLs. Uses `atob` — available in Obsidian's Chromium renderer, and also
 * in Node 22 (this repo's test runtime), so this needs no polyfill to run
 * under Vitest.
 *
 * Never throws: an empty string (the `embedded-assets.ts` placeholder, or a
 * build that genuinely embedded nothing) and malformed input (a corrupted
 * or truncated embed) both come back as `undefined` rather than crashing
 * the caller. The caller treats `undefined` as "no worker embedded", the
 * same clean-failure posture the old file-read path had for a missing file.
 */
export function decodeBase64(
  base64: string,
): Uint8Array<ArrayBuffer> | undefined {
  if (base64 === '') return undefined;
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return undefined;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
