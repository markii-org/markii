import { isResolvableRelativeValue, isSafeResolvedUrl } from './url-resolve.js';

/**
 * The link-rewrite twin of `./image-resolve.js`'s `resolveImageSrc`:
 * `renderMarkToAnsi`'s `resolveHref` option (`render.ts`'s
 * `RenderMarkOptions`), applied to every link an ordinary markdown link
 * produces. Ported verbatim from `@markii/html`'s `href-resolve.ts`.
 *
 * Same resolvability rule as images (no scheme, no protocol-relative
 * `//host/...`, no bare `#fragment`, not empty), and the same
 * `javascript:`/`vbscript:` refusal on the resolver's OWN return value,
 * both shared with `./image-resolve.js` via `./url-resolve.js`.
 */
export type ResolveHref = (href: string) => string | undefined;

/**
 * The value one link should actually carry: `value` unchanged unless
 * `resolveHref` is present, `value` is worth resolving at all, the resolver
 * returns something, and that something passes `isSafeResolvedUrl`. A
 * resolver that throws is treated exactly like one that returned
 * `undefined`: `value` is kept, and the render is never broken over one
 * link.
 */
export function resolveHrefAttribute(
  value: string,
  resolveHref: ResolveHref | undefined,
): string {
  if (!resolveHref) return value;
  if (!isResolvableRelativeValue(value)) return value;

  let resolved: string | undefined;
  try {
    resolved = resolveHref(value);
  } catch {
    return value;
  }
  if (resolved === undefined) return value;
  return isSafeResolvedUrl(resolved) ? resolved : value;
}
