import { describe, expect, it, vi } from 'vitest';
import { buildWebviewHtml, createNonce } from './webview-html';

const BASE_OPTIONS = {
  scriptUri: 'https://example.test/main.js',
  styleUri: 'https://example.test/main.css',
  cspSource: 'https://example.test',
  nonce: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
  title: 'Markii Preview',
};

/** Extracts the `content="..."` value of the CSP meta tag from a built HTML document. */
function extractCsp(html: string): string {
  const match = /Content-Security-Policy" content="([^"]*)"/.exec(html);
  if (!match) throw new Error('CSP meta tag not found');
  return match[1] ?? '';
}

describe('buildWebviewHtml', () => {
  it('sets a default-src none CSP', () => {
    const csp = extractCsp(buildWebviewHtml(BASE_OPTIONS));
    expect(csp).toContain("default-src 'none'");
  });

  it('sets a nonce-scoped script-src matching the given nonce', () => {
    const csp = extractCsp(buildWebviewHtml(BASE_OPTIONS));
    expect(csp).toContain(`script-src 'nonce-${BASE_OPTIONS.nonce}'`);
  });

  it('never allows unsafe-inline in script-src', () => {
    const csp = extractCsp(buildWebviewHtml(BASE_OPTIONS));
    const scriptSrc = /script-src ([^;]*);/.exec(csp)?.[1] ?? '';
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('never allows unsafe-eval anywhere in the CSP', () => {
    const csp = extractCsp(buildWebviewHtml(BASE_OPTIONS));
    expect(csp).not.toContain('unsafe-eval');
  });

  it('contains no remote host other than the literal https: scheme in img-src', () => {
    const csp = extractCsp(
      buildWebviewHtml({ ...BASE_OPTIONS, cspSource: 'vscode-webview://abc' }),
    );
    // Strip out the one legitimate `https:` scheme token (img-src's
    // wildcard-scheme allowance) before checking for any other host.
    const withoutSchemeToken = csp.replace(/\bhttps:(?!\/\/)/g, '');
    expect(withoutSchemeToken).not.toMatch(/https?:\/\//);
  });

  it('embeds the stylesheet and script URIs', () => {
    const html = buildWebviewHtml(BASE_OPTIONS);
    expect(html).toContain(`href="${BASE_OPTIONS.styleUri}"`);
    expect(html).toContain(`src="${BASE_OPTIONS.scriptUri}"`);
  });

  it('sets the script tag nonce attribute', () => {
    const html = buildWebviewHtml(BASE_OPTIONS);
    expect(html).toContain(`<script nonce="${BASE_OPTIONS.nonce}"`);
  });

  it('sets lang and a viewport meta tag', () => {
    const html = buildWebviewHtml(BASE_OPTIONS);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('name="viewport"');
  });

  it('escapes a title containing a script-breakout attempt', () => {
    const html = buildWebviewHtml({
      ...BASE_OPTIONS,
      title: '</title><script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;');
  });

  it('escapes a title containing an attribute-breakout attempt', () => {
    const html = buildWebviewHtml({
      ...BASE_OPTIONS,
      title: '" onload="x',
    });
    expect(html).not.toContain('" onload="x');
    expect(html).toContain('&quot; onload=&quot;x');
  });

  it('escapes ampersands and angle brackets in the title', () => {
    const html = buildWebviewHtml({ ...BASE_OPTIONS, title: 'A <B> & C' });
    expect(html).toContain('A &lt;B&gt; &amp; C');
  });

  it('defines the pack registration bootstrap even with no packs configured', () => {
    const html = buildWebviewHtml(BASE_OPTIONS);
    expect(html).toContain('window.__markiiRegisterPack');
    expect(html).toContain('window.__markiiPackRegistrations=[]');
  });

  it('emits one nonce-carrying <script src> tag per pack, before the main bundle', () => {
    const html = buildWebviewHtml({
      ...BASE_OPTIONS,
      packScriptUris: [
        'https://example.test/packs/demo/pack.js',
        'https://example.test/packs/other/pack.js',
      ],
    });
    const demoTag = `<script nonce="${BASE_OPTIONS.nonce}" src="https://example.test/packs/demo/pack.js"></script>`;
    const otherTag = `<script nonce="${BASE_OPTIONS.nonce}" src="https://example.test/packs/other/pack.js"></script>`;
    expect(html).toContain(demoTag);
    expect(html).toContain(otherTag);
    expect(html.indexOf(demoTag)).toBeLessThan(html.indexOf(otherTag));
    expect(html.indexOf(otherTag)).toBeLessThan(
      html.indexOf(`src="${BASE_OPTIONS.scriptUri}"`),
    );
    expect(html.indexOf('__markiiRegisterPack')).toBeLessThan(
      html.indexOf(demoTag),
    );
  });

  it('escapes a hostile pack script URI', () => {
    const html = buildWebviewHtml({
      ...BASE_OPTIONS,
      packScriptUris: ['https://example.test/x"><script>alert(1)</script>'],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('omits pack script tags entirely when packScriptUris is empty or absent', () => {
    const html = buildWebviewHtml(BASE_OPTIONS);
    // Scoped to the <body> so the CSP explanation's prose examples
    // (literal "<script ...>" text inside the <head> comment) are never
    // mistaken for real tags.
    const body = html.slice(html.indexOf('<body>'));
    const scriptTagCount = (body.match(/<script /g) ?? []).length;
    expect(scriptTagCount).toBe(2);
  });

  it('never adds a pack script host to the CSP script-src directive (the nonce alone authorizes it)', () => {
    const html = buildWebviewHtml({
      ...BASE_OPTIONS,
      packScriptUris: ['https://packs.example.test/demo/pack.js'],
    });
    const csp = extractCsp(html);
    const scriptSrc = /script-src ([^;]*);/.exec(csp)?.[1] ?? '';
    expect(scriptSrc.trim()).toBe(`'nonce-${BASE_OPTIONS.nonce}'`);
  });
});

describe('createNonce', () => {
  it('is 32 characters of [A-Za-z0-9]', () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('differs across calls', () => {
    const a = createNonce();
    const b = createNonce();
    expect(a).not.toBe(b);
  });

  it('is deterministic given an injected random source', () => {
    const a = createNonce(() => 0);
    const b = createNonce(() => 0);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('stays in bounds for a random source returning the edge value 1', () => {
    const nonce = createNonce(() => 1);
    expect(nonce).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it('N-9: the default source is not Math.random (uses a CSPRNG)', () => {
    // We can't observe the RNG algorithm directly, but we can pin the
    // regression this fix guards against: capture `Math.random` calls
    // during a default-arguments `createNonce()` call and assert it was
    // never invoked -- the whole point of N-9 is that the default no
    // longer depends on it.
    const spy = vi.spyOn(Math, 'random');
    try {
      const nonce = createNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9]{32}$/);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
