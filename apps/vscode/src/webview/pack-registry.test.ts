// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { createRegistry } from '@markii/react';
import { buildRenderRegistry } from './pack-registry.js';

const FIXTURE_WEBVIEW_JS = path.resolve(
  import.meta.dirname,
  '../../test-fixtures/packs/demo/webview.js',
);

/** A minimal stand-in for `window.__markiiReact` (real React, without pulling the whole library into this test): `createElement` is all the fixture's `Badge` component calls. */
function fakeReact(): unknown {
  return {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({
      type,
      props,
      children,
    }),
  };
}

/** Sets up the SAME bootstrap `../webview-html.ts` emits inline, before any pack script runs — see that module's doc comment for the load order this mirrors. */
function installBootstrap(): void {
  window.__markiiPackRegistrations = [];
  (window as unknown as Record<string, unknown>).__markiiRegisterPack = (
    manifest: unknown,
    componentModules: unknown,
  ) => {
    (
      window.__markiiPackRegistrations as unknown as Array<{
        manifest: unknown;
        componentModules: unknown;
      }>
    ).push({ manifest, componentModules });
  };
}

beforeEach(() => {
  installBootstrap();
  window.__markiiReact = fakeReact();
});

afterEach(() => {
  window.__markiiPackRegistrations = undefined;
  window.__markiiReact = undefined;
});

describe('buildRenderRegistry', () => {
  it('returns the base registry unchanged when no packs registered', () => {
    const base = createRegistry({ callout: { component: () => null } });
    const registry = buildRenderRegistry(base);
    expect(registry).toBe(base);
  });

  it('merges a real registration pushed by the exemplar fixture pack webview.js', () => {
    // Loads the REAL fixture script into this jsdom window — the same
    // mechanism `<script src="...">` would use in the real webview, just
    // via eval of the actual file contents rather than a network/file
    // fetch (jsdom has no localResourceRoots concept to route through).
    const source = readFileSync(FIXTURE_WEBVIEW_JS, 'utf8');
    (0, eval)(source);

    const base = createRegistry();
    const registry = buildRenderRegistry(base);

    expect(registry['demo_badge']).toBeDefined();
    expect(typeof registry['demo_badge']?.component).toBe('function');
  });

  it('drops a registration with a malformed manifest and logs instead of throwing', () => {
    window.__markiiRegisterPack?.('not json', {
      widget: { component: () => null },
    });
    const base = createRegistry();
    expect(() => buildRenderRegistry(base)).not.toThrow();
    const registry = buildRenderRegistry(base);
    expect(Object.keys(registry)).toEqual([]);
  });

  it('drops a registration whose componentModules is malformed', () => {
    window.__markiiRegisterPack?.(
      JSON.stringify({
        name: 'x',
        engine: 'react',
        components: { a: './A.tsx' },
      }),
      { a: { component: 'not-a-function' } },
    );
    const base = createRegistry();
    const registry = buildRenderRegistry(base);
    expect(Object.keys(registry)).toEqual([]);
  });

  it('rejects two registrations sharing a namespace and falls back to the base registry', () => {
    const manifest = JSON.stringify({
      name: 'demo',
      engine: 'react',
      components: { badge: './Badge.tsx' },
    });
    window.__markiiRegisterPack?.(manifest, {
      badge: { component: () => null },
    });
    window.__markiiRegisterPack?.(manifest, {
      badge: { component: () => null },
    });

    const base = createRegistry({ callout: { component: () => null } });
    const registry = buildRenderRegistry(base);

    expect(registry['demo_badge']).toBeUndefined();
    expect(registry.callout).toBeDefined();
  });
});
