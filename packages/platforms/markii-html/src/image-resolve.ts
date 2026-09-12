import { isResolvableRelativeValue, isSafeResolvedUrl } from './url-resolve.js';

/**
 * The shared logic behind `renderMarkToHtml`'s `resolveImageSrc` option
 * (see `render.ts`'s `RenderMarkOptions`), used everywhere an `<img>`
 * reaches the output string: an ordinary markdown image (`render.ts`'s
 * `makeTransform`, which rewrites a plain hast `img` element in place) and
 * the standard `Figure` component, which builds its own `<img>` HTML from a
 * directive attribute rather than from parsed markdown.
 *
 * A host resolver is only ever asked about a source that could plausibly
 * be its own: one with no scheme, no protocol-relative `//host/...` form,
 * no bare `#fragment`, and no empty/whitespace value — `./url-resolve.js`'s
 * `isResolvableRelativeValue`, shared with `resolveHref`
 * (`./href-resolve.js`) rather than duplicated, and the identical rule
 * `@markii/react`'s `image-resolve.ts` applies.
 *
 * WHY THE RESULT CHECK IS NOT `isSafeUrl`. `isSafeUrl`'s allowlist
 * (`http`/`https`/`mailto`/`tel`) exists to judge a URL an AUTHOR typed
 * into the document, where any other scheme is suspicious. A resolver's
 * RETURN VALUE is the opposite trust direction: it is the HOST's own
 * answer for where its resolved image actually lives, and both reference
 * hosts already return values `isSafeUrl` would reject outright — VS
 * Code's embedded bundle assets are `data:image/...` URIs and Obsidian's
 * vault resource path is an `app://` URL (`@markii/react`'s
 * `image-resolve.ts` names both call sites). Applying `isSafeUrl` here
 * would blank every image either host resolves. What still needs guarding
 * against is a resolver, hostile or merely buggy, echoing a
 * `javascript:`/`vbscript:` value back out — the one class of scheme that
 * turns an `<img src>` into a script-execution vector rather than an image
 * request. `./url-resolve.js`'s `isSafeResolvedUrl` is a narrow denylist
 * for exactly that, not a repeat of the author-facing allowlist. Matches
 * `@markii/react`'s identical function so the two engines cannot diverge.
 */

/** The shape `renderMarkToHtml`/`renderMarkNodeToHtml` accept, and the one carried on `HtmlRenderContext` for a component that builds its own `<img>`. */
export type ResolveImageSrc = (src: string) => string | undefined;

/**
 * The value one `<img src>` should actually carry: `value` unchanged unless
 * `resolveImageSrc` is present, `value` is worth resolving at all, the
 * resolver returns something, and that something passes
 * `isSafeResolvedUrl` — so a resolver can never smuggle a
 * `javascript:` URL past the sanitizer that already ran on everything else
 * in the document, while a legitimate `data:`/`app:`/host-scheme result
 * still reaches the page. A resolver that throws is treated exactly like
 * one that returned `undefined`: `value` is kept, and the render is never
 * broken over one image.
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
