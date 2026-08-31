/**
 * Embedding a note's local images into its exported HTML (GitHub issue #28
 * slice 3, part 1), so an exported file is genuinely self-contained: one
 * document a user can mail, archive, or open on a machine that has never
 * seen the vault, with its pictures still in it.
 *
 * WHERE THIS SITS. `./note-export.ts` composes an already-rendered body
 * string into the export page. This module rewrites that body BEFORE the
 * composition, turning every embeddable `<img src>` into a `data:` URI. It
 * works on the rendered string rather than on the note's AST on purpose:
 * the body is whatever engine rendered it, React or `@markii/html`, and a
 * pack component's own images have to be embedded too. A string rewrite is
 * the one place both engines and every component meet.
 *
 * WHAT STAYS A URL. Anything with a scheme, so `http:` and `https:` sources
 * stay live URLs exactly as authored, and a `data:` URI is already
 * embedded. A protocol-relative `//host/x.png` is a remote source too. Only
 * a genuinely local, relative path is a candidate.
 *
 * THE HOST SEAM. This package knows nothing about vaults, workspace
 * folders, or filesystems, so reading the bytes is injected: a host hands
 * in an `ExportImageReader` that resolves a source the way its own preview
 * resolves one and reads it, or reports that it could not. That keeps
 * `@markii/host` free of host APIs while the size cap, the MIME rules, the
 * base64 encoding, and the reporting stay in ONE place, shared by every
 * host.
 *
 * NOTHING HERE EVER FAILS AN EXPORT. An image that is too large, of an
 * unknown type, missing, or unreadable keeps the source the author wrote
 * and is recorded in the returned report. The host turns that report into
 * diagnostics lines: per AGENTS.md, a skipped image is a quiet fact on the
 * diagnostics surface, never a notice and never a failed export.
 */

/**
 * The per-image ceiling for embedding, 2 MiB. An image above it keeps its
 * original path rather than inflating the exported file by a third of its
 * own size in base64. Exported so a host with a cheap size check can skip
 * reading such a file at all and report `oversize` straight away.
 */
export const MAX_EMBEDDED_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * The extensions this embeds, and the MIME type each becomes. Hand-rolled
 * and deliberately small, in the same spirit as this repo's other
 * hand-rolled validation: an extension that is not on this list is not
 * embedded at all, rather than guessed at with a generic type that a
 * browser would then have to sniff.
 */
const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

/** Every extension `mimeTypeForImageSrc` recognizes, lowercase and without the dot. Exported for a host that wants to name them in its own documentation or tests. */
export const EMBEDDABLE_IMAGE_EXTENSIONS: readonly string[] =
  Object.keys(IMAGE_MIME_TYPES);

/**
 * The MIME type for one image source, read from its extension, or
 * `undefined` when the extension is missing or unrecognized. Any `?query`
 * or `#fragment` is ignored first, so `logo.png?v=2` still reads as a PNG.
 */
export function mimeTypeForImageSrc(src: string): string | undefined {
  const withoutQuery = src.split(/[?#]/, 1)[0] ?? '';
  const lastDot = withoutQuery.lastIndexOf('.');
  if (lastDot === -1) return undefined;
  const extension = withoutQuery.slice(lastDot + 1).toLowerCase();
  if (extension.length === 0) return undefined;
  return Object.prototype.hasOwnProperty.call(IMAGE_MIME_TYPES, extension)
    ? IMAGE_MIME_TYPES[extension]
    : undefined;
}

/**
 * True when `value` begins with a URL scheme, using the same rule as
 * `@markii/core`'s `isSafeUrl` and `apps/vscode/src/webview/
 * document-images.ts`: text before the first `:`, but only when that `:`
 * comes before any `/`, `?` or `#`. So `notes/a:b.png` is correctly a
 * relative path, while `https://x/y.png` and `data:image/png;base64,...`
 * are not.
 */
function hasScheme(value: string): boolean {
  const colon = value.indexOf(':');
  if (colon === -1) return false;
  const slash = value.indexOf('/');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  return (
    (slash === -1 || colon < slash) &&
    (questionMark === -1 || colon < questionMark) &&
    (numberSign === -1 || colon < numberSign)
  );
}

/**
 * True for a source this will try to embed: a non-empty, local, relative
 * path. A scheme of any kind, a protocol-relative `//host/...`, and an
 * empty or fragment-only value are all left exactly as authored.
 */
export function isEmbeddableImageSrc(src: string): boolean {
  if (src.length === 0) return false;
  if (src.startsWith('#')) return false;
  if (src.startsWith('//')) return false;
  return !hasScheme(src);
}

/** What a host's image reader came back with for one source. */
export type ExportImageResult =
  | {
      /** The file's bytes, ready to embed. */
      readonly kind: 'bytes';
      readonly bytes: Uint8Array;
    }
  | {
      /** The host measured the file and it is over `MAX_EMBEDDED_IMAGE_BYTES`, so it never read it. */
      readonly kind: 'oversize';
      readonly byteLength: number;
    }
  | {
      /** The source did not resolve to a readable file, or reading it failed. */
      readonly kind: 'unreadable';
      /** The verbatim reason, for the diagnostics surface only. */
      readonly detail?: string;
    };

/**
 * Reads one image source for an export. A host resolves the source the way
 * its own preview resolves one, applies its own jail, and reads the bytes.
 * It is expected not to throw; one that does is caught by
 * `embedImagesInHtml` and treated as `unreadable`, so an export is never
 * lost to a bad path.
 */
export type ExportImageReader = (
  src: string,
) => ExportImageResult | Promise<ExportImageResult>;

/** Why one image kept its original source instead of being embedded. Only outcomes worth a diagnostics line appear here; a remote URL is not a skip, it is the documented behavior. */
export type ImageSkipReason = 'unsupported-type' | 'too-large' | 'unreadable';

/** One image that was not embedded, and why. */
export interface SkippedImage {
  /** The source exactly as it appears in the note. */
  readonly src: string;
  readonly reason: ImageSkipReason;
  /** The file's size, for a `too-large` skip. */
  readonly byteLength?: number;
  /** The verbatim reason, for an `unreadable` skip. Diagnostics only. */
  readonly detail?: string;
}

/** What one pass of image embedding did, for the host's diagnostics surface. */
export interface EmbeddedImageReport {
  /** The sources that became `data:` URIs, in document order. */
  readonly embedded: readonly string[];
  /** How many bytes of image data the file gained, before base64 expansion. */
  readonly embeddedBytes: number;
  /** Every local image that kept its original source, and why. */
  readonly skipped: readonly SkippedImage[];
  /** How many sources were left alone because they are remote or already embedded. Never a skip; counted only so a host can say the file still reaches the network. */
  readonly remote: number;
}

/** An empty report, for an export that embedded nothing because no host reader was offered. */
export const EMPTY_IMAGE_REPORT: EmbeddedImageReport = {
  embedded: [],
  embeddedBytes: 0,
  skipped: [],
  remote: 0,
};

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 for a byte array, hand-rolled so this module needs neither
 * `Buffer` (Node only) nor `btoa` (which cannot take bytes without a
 * lossy string round trip) and stays environment-free, matching how this
 * repo hand-rolls its manifest validation and `uses:` reader rather than
 * taking a dependency for something this small.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  const full = bytes.length - (bytes.length % 3);
  for (let index = 0; index < full; index += 3) {
    const chunk =
      ((bytes[index] ?? 0) << 16) |
      ((bytes[index + 1] ?? 0) << 8) |
      (bytes[index + 2] ?? 0);
    result +=
      BASE64_ALPHABET[(chunk >> 18) & 63]! +
      BASE64_ALPHABET[(chunk >> 12) & 63]! +
      BASE64_ALPHABET[(chunk >> 6) & 63]! +
      BASE64_ALPHABET[chunk & 63]!;
  }
  const remaining = bytes.length - full;
  if (remaining === 1) {
    const chunk = (bytes[full] ?? 0) << 16;
    result +=
      BASE64_ALPHABET[(chunk >> 18) & 63]! +
      BASE64_ALPHABET[(chunk >> 12) & 63]! +
      '==';
  } else if (remaining === 2) {
    const chunk = ((bytes[full] ?? 0) << 16) | ((bytes[full + 1] ?? 0) << 8);
    result +=
      BASE64_ALPHABET[(chunk >> 18) & 63]! +
      BASE64_ALPHABET[(chunk >> 12) & 63]! +
      BASE64_ALPHABET[(chunk >> 6) & 63]! +
      '=';
  }
  return result;
}

/** One image's bytes as a `data:` URI. Base64 output is alphanumeric plus `+/=`, so it is always safe inside a double-quoted HTML attribute with no further escaping. */
export function toImageDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${encodeBase64(bytes)}`;
}

/** The five entities a renderer escapes in an attribute value, decoded back to the path the author actually wrote. `&amp;` is decoded last so `&amp;lt;` does not become `<`. */
function decodeAttributeValue(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Matches one `<img ...>` start tag. Both renderers emit attribute values
 * in double quotes, and every `<` inside rendered text or code is escaped
 * to `&lt;` before it reaches here, so a `>`-terminated scan cannot run
 * past a tag or match a literal `<img` a note merely talks about.
 */
const IMG_TAG_PATTERN = /<img\b[^>]*>/gi;

/** Matches the `src="..."` attribute inside one already-matched `<img>` tag. */
const SRC_ATTRIBUTE_PATTERN = /(\ssrc=")([^"]*)(")/i;

/**
 * Rewrites every embeddable local `<img src>` in `html` into a `data:` URI,
 * using `readImage` to fetch each source's bytes, and reports what happened
 * to every image it saw.
 *
 * Each distinct source is read at most once, so a note that shows the same
 * picture five times reads and encodes it once and embeds the same URI five
 * times. Never throws: a reader that throws is recorded as `unreadable` and
 * that one image keeps its original source.
 */
export async function embedImagesInHtml(
  html: string,
  readImage: ExportImageReader,
): Promise<{ html: string; report: EmbeddedImageReport }> {
  const embedded: string[] = [];
  const skipped: SkippedImage[] = [];
  let embeddedBytes = 0;
  let remote = 0;

  // Resolved once per distinct source: `undefined` means "keep the original".
  const dataUris = new Map<string, string | undefined>();

  const tags = html.match(IMG_TAG_PATTERN) ?? [];
  for (const tag of tags) {
    const attribute = SRC_ATTRIBUTE_PATTERN.exec(tag);
    if (!attribute) continue;
    const rawSrc = attribute[2] ?? '';
    const src = decodeAttributeValue(rawSrc);

    if (!isEmbeddableImageSrc(src)) {
      if (src.length > 0 && !src.startsWith('#')) remote += 1;
      continue;
    }
    if (dataUris.has(src)) continue;

    const mimeType = mimeTypeForImageSrc(src);
    if (mimeType === undefined) {
      dataUris.set(src, undefined);
      skipped.push({ src, reason: 'unsupported-type' });
      continue;
    }

    let result: ExportImageResult;
    try {
      result = await readImage(src);
    } catch (error) {
      result = {
        kind: 'unreadable',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    if (result.kind === 'oversize') {
      dataUris.set(src, undefined);
      skipped.push({
        src,
        reason: 'too-large',
        byteLength: result.byteLength,
      });
      continue;
    }
    if (result.kind === 'unreadable') {
      dataUris.set(src, undefined);
      skipped.push({
        src,
        reason: 'unreadable',
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      });
      continue;
    }
    // Re-checked here even though a host may have checked already: the cap
    // is this module's rule, and a host that cannot cheaply stat a file
    // legitimately reads first and lets this decide.
    if (result.bytes.byteLength > MAX_EMBEDDED_IMAGE_BYTES) {
      dataUris.set(src, undefined);
      skipped.push({
        src,
        reason: 'too-large',
        byteLength: result.bytes.byteLength,
      });
      continue;
    }

    dataUris.set(src, toImageDataUri(result.bytes, mimeType));
    embedded.push(src);
    embeddedBytes += result.bytes.byteLength;
  }

  const rewritten = html.replace(IMG_TAG_PATTERN, (tag) => {
    const attribute = SRC_ATTRIBUTE_PATTERN.exec(tag);
    if (!attribute) return tag;
    const src = decodeAttributeValue(attribute[2] ?? '');
    const dataUri = dataUris.get(src);
    if (dataUri === undefined) return tag;
    return tag.replace(
      SRC_ATTRIBUTE_PATTERN,
      (_match, before: string, _value: string, after: string) =>
        `${before}${dataUri}${after}`,
    );
  });

  return {
    html: rewritten,
    report: { embedded, embeddedBytes, skipped, remote },
  };
}
