import { isResolvableRelativeValue, isSafeResolvedUrl } from './url-resolve.js';

/**
 * The shared logic behind `renderMarkToAnsi`'s `resolveImageSrc` option
 * (see `render.ts`'s `RenderMarkOptions`), used everywhere an image
 * reference reaches this engine's output: an ordinary markdown image and
 * any future standard component that builds its own image reference from a
 * directive attribute. Ported verbatim from `@markii/html`'s
 * `image-resolve.ts` (itself mirroring `@markii/react`'s).
 *
 * A host resolver is only ever asked about a source that could plausibly
 * be its own: one with no scheme, no protocol-relative `//host/...` form,
 * no bare `#fragment`, and no empty/whitespace value — `./url-resolve.js`'s
 * `isResolvableRelativeValue`, shared with `resolveHref`
 * (`./href-resolve.js`) rather than duplicated.
 *
 * WHY THE RESULT CHECK IS NOT `isSafeUrl`. `isSafeUrl`'s allowlist
 * (`http`/`https`/`mailto`/`tel`) exists to judge a URL an AUTHOR typed
 * into the document, where any other scheme is suspicious. A resolver's
 * RETURN VALUE is the opposite trust direction: it is the HOST's own
 * answer for where its resolved image actually lives, and the two
 * reference hosts already return values `isSafeUrl` would reject outright
 * (a `data:` URI, an `app://` vault path). What still needs guarding
 * against is a resolver, hostile or merely buggy, echoing a
 * `javascript:`/`vbscript:` value back out — the one class of scheme that
 * turns an image reference into a script-execution vector rather than an
 * image request. `./url-resolve.js`'s `isSafeResolvedUrl` is a narrow
 * denylist for exactly that, not a repeat of the author-facing allowlist.
 */

/** The shape `renderMarkToAnsi`/`renderMarkNodeToAnsi` accept, and the one carried on `AnsiRenderContext` for a component that resolves its own image reference. */
export type ResolveImageSrc = (src: string) => string | undefined;

/**
 * The value one image reference should actually carry: `value` unchanged
 * unless `resolveImageSrc` is present, `value` is worth resolving at all,
 * the resolver returns something, and that something passes
 * `isSafeResolvedUrl` — so a resolver can never smuggle a `javascript:` URL
 * past the sanitizer that already ran on everything else in the document,
 * while a legitimate `data:`/`app:`/host-scheme result still reaches the
 * output. A resolver that throws is treated exactly like one that returned
 * `undefined`: `value` is kept, and the render is never broken over one
 * image.
 */
export function resolveImageAttribute(
  value: string,
  resolveImageSrc: ResolveImageSrc | undefined,
): string {
  if (!resolveImageSrc) return value;
  if (!isResolvableRelativeValue(value)) return value;

  let resolved: string | undefined;
  try {
    resolved = resolveImageSrc(value);
  } catch {
    return value;
  }
  if (resolved === undefined) return value;
  return isSafeResolvedUrl(resolved) ? resolved : value;
}
