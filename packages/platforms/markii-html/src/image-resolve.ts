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
 * no bare `#fragment`, and no empty/whitespace value. Everything else
 * already resolves on its own (or is not a path at all) and is left
 * exactly as written — the identical rule `@markii/react`'s
 * `image-resolve.ts` applies, so the two engines cannot diverge on what
 * counts as "relative".
 *
 * The scheme test mirrors `@markii/core`'s `isSafeUrl`: text before the
 * first `:`, but only when that `:` precedes any `/`, `?`, or `#` — so a
 * path that merely contains a colon later on (`notes/a:b.png`) still reads
 * as relative.
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
 * request. `isSafeResolvedImageSrc` below is a narrow denylist for exactly
 * that, not a repeat of the author-facing allowlist. Matches
 * `@markii/react`'s identical function so the two engines cannot diverge.
 */

/** The shape `renderMarkToHtml`/`renderMarkNodeToHtml` accept, and the one carried on `HtmlRenderContext` for a component that builds its own `<img>`. */
export type ResolveImageSrc = (src: string) => string | undefined;

/** The scheme text before the first `:` when one is present in scheme position, lowercased; `undefined` for a schemeless value. Delimiter rule matches `@markii/core`'s `isSafeUrl`. */
function schemeOf(value: string): string | undefined {
  const colon = value.indexOf(':');
  if (colon === -1) return undefined;

  const slash = value.indexOf('/');
  const questionMark = value.indexOf('?');
  const numberSign = value.indexOf('#');
  const hasSchemeBeforeDelimiter =
    (slash === -1 || colon < slash) &&
    (questionMark === -1 || colon < questionMark) &&
    (numberSign === -1 || colon < numberSign);
  return hasSchemeBeforeDelimiter
    ? value.slice(0, colon).toLowerCase()
    : undefined;
}

/** True for a source worth offering to a resolver at all. */
function isResolvableImageSrc(value: string): boolean {
  if (value.trim() === '') return false;
  if (value.startsWith('#')) return false;
  if (value.startsWith('//')) return false;
  return schemeOf(value) === undefined;
}

/** Schemes that turn an `<img src>` into a script-execution vector. Everything else a resolver returns — `https:`, `data:`, `app:`, a host's own custom scheme — is a legitimate resolved location, not a smuggled script. */
const DANGEROUS_IMAGE_SCHEMES = new Set(['javascript', 'vbscript']);

/**
 * `value` reduced to what a browser will actually parse a scheme out of:
 * ASCII tab, line feed and carriage return removed wherever they appear,
 * then leading C0 controls and spaces stripped. The URL parser ignores
 * exactly these, so `"java<TAB>script:alert(1)"` and `" javascript:alert(1)"`
 * both reach the page as the `javascript:` scheme. A scheme test that reads
 * the raw text instead would call both of them schemeless and wave them
 * through, which is the difference between a denylist that holds and one
 * that only looks like it does.
 */
function forSchemeTest(value: string): string {
  return value
    .replace(/[\u0009\u000a\u000d]/g, '')
    .replace(/^[\u0000-\u0020]+/, '');
}

/**
 * True unless `value` carries one of `DANGEROUS_IMAGE_SCHEMES`, judged
 * against `forSchemeTest`'s browser-equivalent reading rather than the raw
 * string. See this module's top comment for why this is a narrow denylist
 * and not `@markii/core`'s author-facing `isSafeUrl` allowlist. Because it
 * IS a denylist, an unrecognized scheme is allowed, so the parsing it rests
 * on has to match the browser's exactly: an allowlist fails closed on a
 * spelling it does not recognize, and this cannot.
 */
function isSafeResolvedImageSrc(value: string): boolean {
  const scheme = schemeOf(forSchemeTest(value));
  return scheme === undefined || !DANGEROUS_IMAGE_SCHEMES.has(scheme);
}

/**
 * The value one `<img src>` should actually carry: `value` unchanged unless
 * `resolveImageSrc` is present, `value` is worth resolving at all, the
 * resolver returns something, and that something passes
 * `isSafeResolvedImageSrc` — so a resolver can never smuggle a
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
  if (!isResolvableImageSrc(value)) return value;

  let resolved: string | undefined;
  try {
    resolved = resolveImageSrc(value);
  } catch {
    return value;
  }
  if (resolved === undefined) return value;
  return isSafeResolvedImageSrc(resolved) ? resolved : value;
}
