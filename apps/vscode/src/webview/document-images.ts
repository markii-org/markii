/**
 * Resolving document-relative image sources in the preview webview.
 *
 * A Markii document can reference an image sitting next to it —
 * `:::figure{src="nice.png"}` or plain `![](nice.png)`. Inside a webview
 * those relative URLs would resolve against the webview's own opaque origin
 * (`vscode-webview://<uuid>/`), which holds nothing, so they simply never
 * load. The host therefore sends a `baseUri` (`protocol.ts`) — the
 * `asWebviewUri` form of the document's folder — and `resolveDocumentUrl`
 * below is `preview.tsx`'s `resolveImageSrc` resolver body, closing over
 * that `baseUri` and the read-only bundle's embedded `assets` map, and
 * handed straight to `@markii/react`'s `renderMark` as an option: the
 * renderer resolves each `<img src>` as it builds the tree, rather than a
 * DOM pass rewriting it afterward.
 *
 * DECISION — a resolver function, NOT a `<base href>` element. A `<base>`
 * would resolve relative image sources with one line, but it changes the
 * resolution of EVERY relative URL on the page, anchors included:
 * `[jump](#section)` would stop being an in-document fragment and become a
 * cross-document navigation to a `vscode-resource` URL, which the webview
 * hands to the editor's external-link handler. `renderMark`'s
 * `resolveImageSrc` option only ever touches `<img src>`, by construction —
 * it is never offered an anchor's `href` — so that blast radius stays zero.
 * (The nonce'd script and the stylesheet are unaffected either way —
 * `preview-panel.ts` gives both absolute `asWebviewUri` URLs, and they are
 * loaded before any of this runs.)
 *
 * SECURITY — this module resolves, it does not authorize. A traversal
 * attempt (`src="../../etc/passwd"`) resolves to a URL outside the panel's
 * `localResourceRoots`, and VS Code refuses to serve it: the image is simply
 * blank, with nothing disclosed. Scheme safety is likewise upstream —
 * `@markii/core`'s `isSafeUrl` has already dropped `javascript:` sources
 * before they reach the DOM, `isSafeBaseUri` (`protocol.ts`) has already
 * rejected a hostile base, and `renderMark` re-checks `isSafeUrl` again on
 * whatever this function returns, so a value that already carries a scheme
 * is left exactly as it is.
 */

/**
 * True when `value` begins with a URL scheme, using the same
 * "text before the first `:`, but only when that `:` precedes any `/`, `?`
 * or `#`" rule as `@markii/core`'s `isSafeUrl` — so a path that merely
 * contains a colon later on (`notes/a:b.png`) is correctly treated as
 * relative.
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
 * Normalizes a relative image `src` into the key form
 * `extractAssetsAsDataUris` (`bundle-resolve.ts`) uses for its map: strips
 * any leading `./` segments and a leading `/`, so `assets/a.png`,
 * `./assets/a.png`, and `/assets/a.png` all look up the same entry. Never
 * resolves `..` — a lookup key containing one simply won't be in the map
 * (the map is built only from paths a jailed `BundleStorage.list()` ever
 * returned), so a traversal attempt fails closed by construction rather
 * than by an extra check here.
 */
function assetLookupKey(value: string): string {
  let result = value;
  while (result.startsWith('./')) result = result.slice(2);
  while (result.startsWith('/')) result = result.slice(1);
  return result;
}

/**
 * The absolute (or embedded) form of a document-relative `value`, or
 * `undefined` when `value` must be left untouched — which covers every case
 * that is already resolvable on its own: an absolute URL (`https://…`,
 * `data:…`), a protocol-relative `//host/…`, a bare fragment `#…`, an
 * empty/whitespace source, and any value at all when neither `baseUri` nor
 * `assets` is known (an unsaved document, or a read-only zip-form bundle
 * preview with no matching embedded asset).
 *
 * `assets` (a read-only zip-form bundle's embedded images, see
 * `protocol.ts`'s `UpdateMessage.assets`) is tried FIRST when present: a zip
 * bundle preview has no real folder for `baseUri` to point at, so a
 * document-relative image can only ever come from the embedded map. A
 * `baseUri` that fails to parse yields `undefined` too, so a bad base
 * degrades to today's behavior rather than throwing mid-render.
 */
export function resolveDocumentUrl(
  value: string,
  baseUri: string | undefined,
  assets?: Readonly<Record<string, string>>,
): string | undefined {
  if (value.trim() === '') return undefined;
  if (value.startsWith('#')) return undefined;
  if (value.startsWith('//')) return undefined;
  if (hasScheme(value)) return undefined;

  if (assets !== undefined) {
    const hit = assets[assetLookupKey(value)];
    if (hit !== undefined) return hit;
  }

  if (baseUri === undefined) return undefined;
  try {
    return new URL(value, baseUri).toString();
  } catch {
    return undefined;
  }
}
