/**
 * The scheme-safety logic shared by every host-resolver seam on this
 * engine's `RenderMarkOptions`: `resolveImageSrc` (`./image-resolve.js`)
 * and `resolveHref` (`./href-resolve.js`). Both seams follow the identical
 * shape: offer a host resolver a value that looks like ITS OWN relative
 * path, then refuse a `javascript:`/`vbscript:` scheme in whatever the
 * resolver hands back. That logic lives here ONCE and each seam's module
 * only adds the one-line wrapper that names its own option
 * (`resolveImageSrc` vs `resolveHref`). See `./image-resolve.js`'s top
 * comment for the full rationale: why the result is checked against a
 * narrow denylist here, not `@markii/core`'s author-facing `isSafeUrl`
 * allowlist. Mirrors `@markii/react`'s `url-resolve.ts` so the two engines
 * cannot diverge on what counts as a dangerous scheme.
 */

/**
 * The scheme text before the first `:` when one is present in scheme
 * position, lowercased; `undefined` for a schemeless value. Delimiter rule
 * matches `@markii/core`'s `isSafeUrl`.
 */
export function schemeOf(value: string): string | undefined {
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

/**
 * True for a value worth offering to a resolver at all: no scheme, no
 * protocol-relative `//host/...` form, no bare `#fragment`, not
 * empty/whitespace.
 */
export function isResolvableRelativeValue(value: string): boolean {
  if (value.trim() === '') return false;
  if (value.startsWith('#')) return false;
  if (value.startsWith('//')) return false;
  return schemeOf(value) === undefined;
}

/**
 * Schemes that turn a resolved URL into a script-execution vector.
 * Everything else a resolver returns (`https:`, `data:`, `app:`, a host's
 * own custom scheme) is a legitimate resolved location, not a smuggled
 * script.
 */
export const DANGEROUS_URL_SCHEMES = new Set(['javascript', 'vbscript']);

const TAB_NEWLINE_CR = new RegExp('[\\u0009\\u000a\\u000d]', 'g');
const LEADING_C0_OR_SPACE = new RegExp('^[\\u0000-\\u0020]+');

/**
 * `value` reduced to what a browser will actually parse a scheme out of:
 * ASCII tab, line feed and carriage return removed wherever they appear,
 * then leading C0 controls and spaces stripped. The URL parser ignores
 * exactly these, so a tab or newline spliced into the middle of a scheme
 * name, or leading whitespace/control characters before it, both still
 * reach the page as that scheme. A scheme test that reads the raw text
 * instead would call both of them schemeless and wave them through, which
 * is the difference between a denylist that holds and one that only looks
 * like it does.
 */
export function forSchemeTest(value: string): string {
  return value.replace(TAB_NEWLINE_CR, '').replace(LEADING_C0_OR_SPACE, '');
}

/**
 * True unless `value` carries one of `DANGEROUS_URL_SCHEMES`, judged
 * against `forSchemeTest`'s browser-equivalent reading rather than the raw
 * string. Because this IS a denylist, an unrecognized scheme is allowed, so
 * the parsing it rests on has to match the browser's exactly: an allowlist
 * fails closed on a spelling it does not recognize, and this cannot.
 */
export function isSafeResolvedUrl(value: string): boolean {
  const scheme = schemeOf(forSchemeTest(value));
  return scheme === undefined || !DANGEROUS_URL_SCHEMES.has(scheme);
}
