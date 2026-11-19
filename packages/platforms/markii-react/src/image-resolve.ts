import {
  forSchemeTest,
  isResolvableRelativeValue,
  isSafeResolvedUrl,
  schemeOf,
} from './url-resolve.js';

/**
 * The shared logic behind `renderMark`'s `resolveImageSrc` option (see
 * `render.tsx`'s `RenderMarkOptions`), used everywhere an `<img>` reaches
 * the page: an ordinary markdown image (`render.tsx`'s `ImgElement`) and
 * the standard `Figure` component, which builds its own `<img>` from a
 * directive attribute rather than from parsed markdown.
 *
 * A host resolver is only ever asked about a source that could plausibly
 * be its own: one with no scheme, no protocol-relative `//host/...` form,
 * no bare `#fragment`, and no empty/whitespace value. Everything else
 * already resolves on its own (or is not a path at all) and is left
 * exactly as written, matching `apps/vscode/src/webview/document-images.ts`
 * and `apps/obsidian/src/vault-image-paths.ts`, which used the identical
 * rule before this option existed. `resolveHref` (`./href-resolve.js`)
 * follows the identical shape; both seams share `./url-resolve.js`'s
 * scheme logic rather than each defining their own copy.
 *
 * WHY THE RESULT CHECK IS NOT `isSafeUrl`. `isSafeUrl`'s allowlist
 * (`http`/`https`/`mailto`/`tel`) exists to judge a URL an AUTHOR typed
 * into the document, where any other scheme is suspicious. A resolver's
 * RETURN VALUE is the opposite trust direction: it is the HOST's own
 * answer for where its resolved image actually lives, and both reference
 * hosts already return values `isSafeUrl` would reject outright — VS
 * Code's embedded bundle assets are `data:image/...` URIs
 * (`apps/vscode/src/webview/document-images.ts`'s `assets` map) and
 * Obsidian's vault resource path is an `app://` URL
 * (`apps/obsidian/src/preview-images.ts`'s `resolveVaultImageResource`).
 * Applying `isSafeUrl` here would blank every image either host resolves.
 * What still needs guarding against is a resolver, hostile or merely
 * buggy, echoing a `javascript:`/`vbscript:` value back out — the one
 * class of scheme that turns an `<img src>` into a script-execution
 * vector rather than an image request. `./url-resolve.js`'s
 * `isSafeResolvedUrl` is a narrow denylist for exactly that, not a repeat
 * of the author-facing allowlist.
 */

/** How the browser is told to fetch an image: `lazy` defers it until it nears the viewport. */
export type ImageLoading = 'lazy' | 'eager';

/**
 * The object form a `resolveImageSrc` callback may return instead of a bare
 * string. `width` and `height` become attributes. `srcset` and `sizes` pass
 * through together (`sizes` alone is dropped). `loading` overrides the
 * default for this one image.
 */
export interface ResolvedImage {
  readonly src: string;
  readonly width?: number;
  readonly height?: number;
  readonly srcset?: string;
  readonly sizes?: string;
  readonly loading?: ImageLoading;
}

/** What a `resolveImageSrc` callback returns: a string, the object form, or `undefined` to leave the source as written. */
export type ImageResolution = string | ResolvedImage;

/** The shape the render options accept, and the one every component that emits its own `<img>` receives. */
export type ResolveImageSrc = (src: string) => ImageResolution | undefined;

/** Every attribute one `<img>` carries once the resolver has answered. */
export interface ImageAttributes {
  readonly src: string;
  readonly width?: number;
  readonly height?: number;
  readonly srcset?: string;
  readonly sizes?: string;
  readonly loading: ImageLoading;
  /** True when the resolver's `srcset` named a refused candidate and was dropped. */
  readonly srcsetRefused: boolean;
}

/**
 * The scheme check for one resolved image URL, used for `src` and for every
 * `srcset` candidate alike: `isSafeResolvedUrl`'s denylist, plus a refusal of
 * a `data:` URL that is not an image. A `data:text/html` URL never runs in an
 * `<img>`, but an image reference has no reason to carry one.
 */
export function isSafeResolvedImageUrl(value: string): boolean {
  if (!isSafeResolvedUrl(value)) return false;
  const scheme = schemeOf(forSchemeTest(value));
  if (scheme !== 'data') return true;
  return /^data:image\//i.test(forSchemeTest(value));
}

const WHITESPACE = /\s/;

/**
 * The candidate URLs of a `srcset` value, read the way the HTML parser reads
 * it: whitespace and commas separate candidates, a URL is the next run of
 * non-whitespace characters (trailing commas removed), and descriptors run
 * to the next comma outside parentheses. A URL may itself contain commas, as
 * a `data:` URL does, which is why a plain split on commas is not used.
 */
export function srcsetCandidateUrls(srcset: string): string[] {
  const urls: string[] = [];
  let position = 0;
  const length = srcset.length;
  while (position < length) {
    while (
      position < length &&
      (WHITESPACE.test(srcset[position]!) || srcset[position] === ',')
    ) {
      position += 1;
    }
    if (position >= length) break;

    const start = position;
    while (position < length && !WHITESPACE.test(srcset[position]!)) {
      position += 1;
    }
    let url = srcset.slice(start, position);
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let depth = 0;
      while (position < length) {
        const character = srcset[position]!;
        if (character === '(') depth += 1;
        else if (character === ')' && depth > 0) depth -= 1;
        else if (character === ',' && depth === 0) break;
        position += 1;
      }
    }
    if (url !== '') urls.push(url);
  }
  return urls;
}

/**
 * True when every candidate of `srcset` passes `isSafeResolvedImageUrl`. A
 * second, blunter pass also tests every run between whitespace and commas, so
 * a scheme hidden behind a comma trick the parser would read as one odd URL
 * still refuses the whole value.
 */
export function isSafeSrcset(srcset: string): boolean {
  for (const url of srcsetCandidateUrls(srcset)) {
    if (!isSafeResolvedImageUrl(url)) return false;
  }
  // The blunt pass runs on the value as written and with tab, line feed and
  // carriage return removed, since a URL parser deletes those inside a scheme.
  const stripped = srcset.replace(/[\t\n\r]/g, '');
  for (const text of [srcset, stripped]) {
    for (const token of text.split(/[\s,]+/)) {
      if (token !== '' && !isSafeResolvedImageUrl(token)) return false;
    }
  }
  return true;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/**
 * The attributes one `<img>` should carry. `value` is the source as written.
 * The resolver is consulted only for a source worth resolving. Its answer is
 * used only when its `src` passes `isSafeResolvedImageUrl`, otherwise the
 * whole answer is ignored and `value` is kept. A `srcset` with any refused
 * candidate is dropped with its `sizes`, and `srcsetRefused` says so. A
 * resolver that throws is treated like one that returned `undefined`.
 * `defaultLoading` applies unless the resolver names `loading`; `force`
 * overrides both.
 */
export function resolveImageAttributes(
  value: string,
  resolveImageSrc: ResolveImageSrc | undefined,
  defaultLoading: ImageLoading = 'lazy',
  force?: ImageLoading,
): ImageAttributes {
  const plain: ImageAttributes = {
    src: value,
    loading: force ?? defaultLoading,
    srcsetRefused: false,
  };
  if (!resolveImageSrc) return plain;
  if (!isResolvableRelativeValue(value)) return plain;

  let resolved: ImageResolution | undefined;
  try {
    resolved = resolveImageSrc(value);
  } catch {
    return plain;
  }
  if (resolved === undefined || resolved === null) return plain;
  if (typeof resolved === 'string') {
    return isSafeResolvedImageUrl(resolved)
      ? { ...plain, src: resolved }
      : plain;
  }
  if (typeof resolved !== 'object' || typeof resolved.src !== 'string') {
    return plain;
  }
  if (!isSafeResolvedImageUrl(resolved.src)) return plain;

  const srcset =
    typeof resolved.srcset === 'string' && resolved.srcset.trim() !== ''
      ? resolved.srcset
      : undefined;
  const srcsetRefused = srcset !== undefined && !isSafeSrcset(srcset);
  const keepSrcset = srcset !== undefined && !srcsetRefused;
  const loading =
    resolved.loading === 'lazy' || resolved.loading === 'eager'
      ? resolved.loading
      : defaultLoading;
  const width = positiveInteger(resolved.width);
  const height = positiveInteger(resolved.height);

  return {
    src: resolved.src,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(keepSrcset ? { srcset } : {}),
    ...(keepSrcset && typeof resolved.sizes === 'string'
      ? { sizes: resolved.sizes }
      : {}),
    loading: force ?? loading,
    srcsetRefused,
  };
}

/**
 * The `src` one `<img>` should carry: `resolveImageAttributes`'s answer, for
 * a caller that needs nothing else.
 */
export function resolveImageAttribute(
  value: string,
  resolveImageSrc: ResolveImageSrc | undefined,
): string {
  return resolveImageAttributes(value, resolveImageSrc).src;
}

/**
 * The `src` one `<video>` should carry, or `null` when it must not be drawn.
 * The resolver answers as it does for an image. A clip then refuses every
 * `data:` URL, in any letter case and with any whitespace the URL parser
 * would remove, because a clip has no business being inline.
 */
export function resolveVideoSrc(
  value: string,
  resolveImageSrc: ResolveImageSrc | undefined,
): string | null {
  const src = resolveImageAttributes(value, resolveImageSrc).src;
  return schemeOf(forSchemeTest(src)) === 'data' ? null : src;
}
