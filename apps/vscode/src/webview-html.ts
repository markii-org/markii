/**
 * Builds the HTML shell `preview-panel.ts` assigns to `webview.html`. Kept
 * `vscode`-free and pure (options in, string out) so it is plain,
 * unit-tested TypeScript — the security-relevant parts (the CSP, and escaping
 * every interpolated value) are exactly the parts worth testing in
 * isolation, without a real `vscode.Webview` in the loop.
 */

import { randomBytes } from 'node:crypto';

export interface WebviewHtmlOptions {
  readonly scriptUri: string;
  readonly styleUri: string;
  readonly cspSource: string;
  readonly nonce: string;
  readonly title: string;
  /**
   * Webview-visible URIs of every configured, installed pack's prebuilt
   * registration script (GitHub issue #3 slice 5, docs/packs.md) — one per
   * pack, resolved by `preview-panel.ts` from the `markii.packs` setting
   * and already restricted to `localResourceRoots` entries covering ONLY
   * those configured folders (never a workspace-wide root, never anything
   * derived from note/document content). Each is loaded via its own
   * `<script nonce=... src=...>` tag, in this array's order, BEFORE the
   * main bundle — see `buildWebviewHtml`'s doc comment on the registration
   * convention. Empty (or omitted) when no packs are configured; the shell
   * is then byte-for-byte what it always was.
   */
  readonly packScriptUris?: readonly string[];
  /**
   * Webview-visible URIs of every configured, installed pack's emitted
   * stylesheet (`@markii/host`'s `packs/pack-build.ts`, the pack-CSS design) — a pack
   * whose build produced no `.css` (no CSS import) simply has no entry
   * here. Rendered as `<link rel="stylesheet">` tags, in this array's
   * order, placed AFTER `styleUri`'s own `<link>` (`doc.css` + the host
   * theme layer, `./webview/main.tsx`'s load order) — see
   * `buildWebviewHtml`'s doc comment for why this order is part of the
   * contract, not incidental. Empty (or omitted) when no pack produced a
   * stylesheet; the shell is then unchanged from before this field
   * existed except for the omitted tags.
   */
  readonly packStyleUris?: readonly string[];
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes the five HTML-significant characters. Written by hand (no dependency) per AGENTS.md's dependency rule — this is the extension's ONLY place untrusted/host-supplied text is interpolated into markup. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * Builds the webview document's `<head>`/`<body>` shell. `#root` holds an
 * empty `.doc` placeholder — `webview/main.tsx` mounts React onto `#root`
 * and immediately replaces its contents, so the placeholder is never
 * visible in practice; it exists only so the shell is valid, renderable
 * markup even for the instant before the bundle's script runs.
 *
 * Every option is treated as untrusted text and run through `escapeHtml`
 * before interpolation — `scriptUri`/`styleUri`/`cspSource` come from
 * `vscode.Webview.asWebviewUri`/`cspSource`, `nonce` from `createNonce`
 * below, `packScriptUris` from `asWebviewUri` over the `markii.packs`
 * setting's configured folders (never document content), and `title` is a
 * static string today, but none of that is assumed here: nothing reaches
 * the markup unescaped.
 *
 * ## Pack registration convention (GitHub issue #3 slice 5, docs/packs.md)
 *
 * Three script groups load in this fixed order, all under the SAME nonce
 * (a nonce-scoped CSP authorizes every `<script nonce="...">` tag carrying
 * it, inline or external — this is strictly tighter than `'unsafe-inline'`,
 * which would authorize ANY inline script, forged or not):
 *
 * 1. A tiny inline bootstrap defines `window.__markiiRegisterPack`, a queue
 *    a pack's registration call pushes onto (`window.__markiiPackRegistrations`).
 * 2. Each pack's prebuilt registration script (`packScriptUris`), one
 *    `<script>` tag per pack, loaded ONLY from `localResourceRoots` entries
 *    the panel restricts to the exact folders `markii.packs` names — see
 *    `preview-panel.ts`. A pack script calls
 *    `window.__markiiRegisterPack(manifest, componentModules)` synchronously
 *    at load time; `componentModules` are plain functions that reference
 *    `window.__markiiReact` (the host's own React, set by step 3 below)
 *    LAZILY, i.e. only when actually invoked to render, never at load
 *    time — packs never bundle their own React copy, so there is only ever
 *    one React instance in the page.
 * 3. The main webview bundle (`scriptUri`) sets `window.__markiiReact` to
 *    its own React import, reads `window.__markiiPackRegistrations`, merges
 *    every registered pack into the render registry via `@markii/react`'s
 *    `installPacks`, and mounts.
 *
 * If a pack script fails to load (a 404, a syntax error, anything) the
 * `<script>` tag simply never calls `__markiiRegisterPack` — the queue is
 * just missing that entry, `main.js` still loads and mounts normally, and
 * every directive from that pack's namespace falls through to the ordinary
 * unknown-component fallback box. Nothing here can break the rest of the
 * page over one bad pack script.
 *
 * The bootstrap script (step 1) is emitted unconditionally, even with zero
 * packs configured — it is a fixed handful of bytes with no dependency on
 * `packScriptUris`, so there is no reason to special-case the empty case.
 *
 * ## Pack stylesheet load order (the pack-CSS design)
 *
 * A pack's emitted stylesheet (`packStyleUris`, one `<link
 * rel="stylesheet">` per pack that has one) loads in `<head>` right after
 * `styleUri`'s own `<link>` — which is `doc.css` followed by the host's
 * theme layer, bundled together as `./webview/main.tsx` documents. That
 * order is part of the contract, not incidental: loading pack CSS AFTER
 * `doc.css` lets a pack consume the resolved `--mk-*` token values (the
 * whole point of Rule A in `./packs/pack-css-lint.ts` — a token only
 * resolves to something once `doc.css` has declared it), and loading it
 * AFTER the theme layer means the theme layer's broad selectors (see
 * `./webview/theme.css`) can never accidentally override a pack's own
 * rules just by cascade order. `style-src` already authorizes same-origin
 * `cspSource` URIs (needed for the standard component set's inline style
 * attributes — see the CSP comment below), so no nonce is needed on a
 * `<link>` tag; `localResourceRoots` (`preview-panel.ts`) is what actually
 * gates which stylesheet files may load, same as every pack script.
 */
export function buildWebviewHtml(options: WebviewHtmlOptions): string {
  const scriptUri = escapeHtml(options.scriptUri);
  const styleUri = escapeHtml(options.styleUri);
  const cspSource = escapeHtml(options.cspSource);
  const nonce = escapeHtml(options.nonce);
  const title = escapeHtml(options.title);
  const packScriptUris = (options.packScriptUris ?? []).map(escapeHtml);
  const packStyleUris = (options.packStyleUris ?? []).map(escapeHtml);

  const packScriptTags = packScriptUris
    .map((uri) => `<script nonce="${nonce}" src="${uri}"></script>`)
    .join('\n');
  const packStyleTags = packStyleUris
    .map((uri) => `<link rel="stylesheet" href="${uri}">`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<!--
  Content-Security-Policy, directive by directive:

  - script-src is nonce-only: no 'unsafe-inline', no remote host, and
    deliberately NO added host/path entries for pack scripts either. A
    nonce-scoped script-src authorizes every <script nonce="..."> element
    carrying the matching nonce REGARDLESS of its src origin — that is the
    mechanism, not a gap — so listing each pack's exact URL here would add
    nothing (the nonce already covers it) while making the policy more
    fragile (CSP path-source matching is exact/prefix-based and would need
    to track every pack's resolved webview URI byte-for-byte). The actual
    boundary on WHICH files a pack <script src=...> may load is
    localResourceRoots (preview-panel.ts), restricted to exactly the
    folders the markii.packs setting names — never a workspace-wide root,
    never anything derived from note/document content. A fresh nonce per
    HTML load, shared by the main bundle, the tiny inline pack-registration
    bootstrap, and every pack script tag, is sufficient and strictly
    tighter than allowing inline/remote script generally — see
    buildWebviewHtml's doc comment for the registration convention this
    supports.

  - style-src allows 'unsafe-inline' because the standard component set
    sets style ATTRIBUTES directly at render time — e.g.
    packages/platforms/markii-react/src/components/progress.tsx's
    style={{ width: ... }} bar fill (~line 121) and chart.tsx's empty-state
    box sizing (~line 212) — and CSP's style-src governs style ATTRIBUTES
    too whenever the narrower style-src-attr is absent, which it is here.
    There is no attribute-only keyword that would let those components keep
    working without this.

  - img-src allows https: and data: so document images and figure
    directives can load — the same posture VS Code's own built-in markdown
    preview takes — at the cost that opening a document with a remote image
    contacts that image's host. Its cspSource term is what additionally
    permits LOCAL images: a relative src is rewritten to the document
    folder's asWebviewUri form (webview/document-images.ts), which is a
    cspSource URL. That widens nothing on its own — which local files may
    actually be served is decided by the panel's localResourceRoots
    (preview-panel.ts), not by this policy.
-->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${styleUri}">
${packStyleTags}
<title>${title}</title>
</head>
<body>
<div id="root"><div class="doc"></div></div>
<script nonce="${nonce}">window.__markiiPackRegistrations=[];window.__markiiRegisterPack=function(manifest,componentModules){window.__markiiPackRegistrations.push({manifest:manifest,componentModules:componentModules});};</script>
${packScriptTags}
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
`;
}

const NONCE_LENGTH = 32;
const NONCE_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('');

/**
 * Picks one nonce character from a `[0, 1)` random sample. Falls back to
 * the first character for an out-of-range sample (a hostile/buggy injected
 * `randomValues` returning exactly `1` or something negative) rather than
 * indexing out of bounds — `NONCE_CHARS[index]` is `string | undefined`
 * under `noUncheckedIndexedAccess`, so this is the one place that ever
 * needs to be defensive about it.
 */
function pickNonceChar(sample: number): string {
  const clamped = Math.min(Math.max(sample, 0), 1 - Number.EPSILON);
  const index = Math.floor(clamped * NONCE_CHARS.length);
  return NONCE_CHARS[index] ?? 'A';
}

/**
 * A `[0, 1)` sample drawn from `node:crypto`'s CSPRNG (N-9 fix,
 * docs/archive/PENTEST-REPORT-2026-08-23.md) rather than `Math.random`, which is not
 * cryptographically strong in V8 and is unsuitable as the sole source of
 * entropy for something whose whole job is being unguessable. Reads 4 random
 * bytes as an unsigned 32-bit integer and scales it into `[0, 1)`, matching
 * `Math.random`'s own contract closely enough that `pickNonceChar` needs no
 * changes.
 */
function cryptoRandom(): number {
  return randomBytes(4).readUInt32BE(0) / 0x100000000;
}

/**
 * Generates a fresh 32-character `[A-Za-z0-9]` nonce for one `script-src
 * 'nonce-...'` CSP value / `<script nonce="...">` pair. `preview-panel.ts`
 * calls this once per `buildWebviewHtml` call (never reused across HTML
 * loads, so a stale nonce can never authorize a new script).
 *
 * `randomValues` defaults to `cryptoRandom` (a CSPRNG source) and is
 * injectable so tests get a deterministic sequence instead of depending on
 * real randomness.
 */
export function createNonce(randomValues: () => number = cryptoRandom): string {
  let nonce = '';
  for (let i = 0; i < NONCE_LENGTH; i++) {
    nonce += pickNonceChar(randomValues());
  }
  return nonce;
}
