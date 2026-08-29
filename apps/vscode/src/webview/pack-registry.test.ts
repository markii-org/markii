// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
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
    const result = buildRenderRegistry(base);
    expect(result.registry).toBe(base);
    expect(result.invalidReasons).toEqual([]);
    expect(result.collisions).toEqual([]);
    expect(result.duplicateComposedNames).toEqual([]);
  });

  it('merges a real registration pushed by the exemplar fixture pack webview.js', () => {
    // Loads the REAL fixture script into this jsdom window — the same
    // mechanism `<script src="...">` would use in the real webview, just
    // via eval of the actual file contents rather than a network/file
    // fetch (jsdom has no localResourceRoots concept to route through).
    const source = readFileSync(FIXTURE_WEBVIEW_JS, 'utf8');
    (0, eval)(source);

    const base = createRegistry();
    const result = buildRenderRegistry(base);

    expect(result.registry['demo_badge']).toBeDefined();
    expect(typeof result.registry['demo_badge']?.component).toBe('function');
  });

  it('drops a registration with a malformed manifest, never throws, and records the reason', () => {
    window.__markiiRegisterPack?.('not json', {
      widget: { component: () => null },
    });
    const base = createRegistry();
    expect(() => buildRenderRegistry(base)).not.toThrow();
    const result = buildRenderRegistry(base);
    expect(Object.keys(result.registry)).toEqual([]);
    expect(result.invalidReasons).toHaveLength(1);
  });

  it('drops a registration whose componentModules is malformed and records the reason', () => {
    window.__markiiRegisterPack?.(
      JSON.stringify({
        name: 'x',
        engine: 'react',
        components: { a: './A.tsx' },
      }),
      { a: { component: 'not-a-function' } },
    );
    const base = createRegistry();
    const result = buildRenderRegistry(base);
    expect(Object.keys(result.registry)).toEqual([]);
    expect(result.invalidReasons).toHaveLength(1);
  });

  it('normalizes a raw queue entry that is not even a plain object into a recorded reason, rather than silently dropping it', () => {
    // Push a hostile entry directly, bypassing `__markiiRegisterPack` (which
    // always pushes a plain object) — this is the shape a corrupt or
    // adversarial script could still leave in the queue.
    (window.__markiiPackRegistrations as unknown as unknown[]).push(
      'not an object',
    );
    const base = createRegistry();
    const result = buildRenderRegistry(base);
    expect(Object.keys(result.registry)).toEqual([]);
    expect(result.invalidReasons).toHaveLength(1);
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
    const result = buildRenderRegistry(base);

    expect(result.registry['demo_badge']).toBeUndefined();
    expect(result.registry.callout).toBeDefined();
    expect(result.collisions).toEqual(['demo']);
  });

  it('two differently named packs compose to different directive names under ordinary registration (composeDirectiveName is bijective under the lowercase-kebab charset), so no duplicate is reported for the common case', () => {
    const base = createRegistry();
    window.__markiiRegisterPack?.(
      JSON.stringify({
        name: 'demo',
        engine: 'react',
        components: { badge: './Badge.tsx' },
      }),
      { badge: { component: () => 1 } },
    );
    window.__markiiRegisterPack?.(
      JSON.stringify({
        name: 'demo2',
        engine: 'react',
        components: { badge: './Badge.tsx' },
      }),
      { badge: { component: () => 2 } },
    );
    const result = buildRenderRegistry(base);

    expect(result.registry['demo_badge']).toBeDefined();
    expect(result.registry['demo2_badge']).toBeDefined();
    expect(result.duplicateComposedNames).toEqual([]);
  });
});

describe('buildRenderRegistry — surfacing a duplicate-composed-name skip', () => {
  // Two DIFFERENTLY NAMED packs can never compose to the SAME directive name
  // through ordinary `packName + "_" + localName` registration: both
  // segments are restricted to a lowercase-kebab charset that forbids `_`,
  // so the single underscore `composeDirectiveName` inserts is always the
  // unambiguous boundary between the two (see
  // `packages/markii-pack/src/namespace.ts`'s top doc comment). There is no
  // manifest this webview could register that legitimately reaches
  // `duplicateComposedNames` non-empty, so this test constructs the
  // collision directly: it stubs `@markii/host/browser`'s
  // `buildRenderRegistry` to return a `BuildRenderRegistryResult` carrying a
  // hand-built `DuplicateComposedName`, and asserts this file's own
  // `buildRenderRegistry` forwards it unchanged. What this file owns is the
  // forwarding (so `./main.tsx` can post it to the extension host); the
  // keep-first DECISION itself lives in, and is the responsibility of,
  // `@markii/host/browser`'s own merge.
  it('forwards a duplicateComposedNames entry the shared merge reports', async () => {
    const duplicate = {
      composedName: 'demo_badge',
      keptPack: 'demo',
      skippedPack: 'demo2',
    };
    const stubbedRegistry = createRegistry({
      demo_badge: { component: () => null },
    });
    vi.doMock('@markii/host/browser', () => ({
      buildRenderRegistry: () => ({
        registry: stubbedRegistry,
        invalidReasons: [],
        collisions: [],
        duplicateComposedNames: [duplicate],
      }),
    }));
    vi.resetModules();
    try {
      const { buildRenderRegistry: buildWithStub } =
        await import('./pack-registry.js');
      const base = createRegistry();
      const result = buildWithStub(base);
      expect(result.duplicateComposedNames).toEqual([duplicate]);
      expect(result.registry).toBe(stubbedRegistry);
    } finally {
      vi.doUnmock('@markii/host/browser');
      vi.resetModules();
    }
  });
});
