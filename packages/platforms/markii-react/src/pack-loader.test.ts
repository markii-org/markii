import { describe, expect, it } from 'vitest';
import type { PackManifest } from '@markii/pack';
import { REACT_ENGINE_ID, installPacks, loadPack } from './pack-loader';
import type { PackComponentModules } from './pack-loader';
import { createRegistry } from './registry';
import type { MarkComponentProps, RegistryEntry } from './registry';

function stubComponent(_props: MarkComponentProps): null {
  return null;
}

function entry(): RegistryEntry {
  return { component: stubComponent };
}

function anaManifest(overrides: Partial<PackManifest> = {}): PackManifest {
  return {
    name: 'ana',
    engine: REACT_ENGINE_ID,
    components: { timeline: './Timeline.tsx' },
    ...overrides,
  };
}

describe('loadPack', () => {
  it('registers a pack component under the namespaced directive name', () => {
    const timeline = entry();
    const modules: PackComponentModules = { timeline };
    const registry = loadPack(anaManifest(), modules);
    expect(registry['ana_timeline']).toBe(timeline);
    // The bare local name must never be auto-registered (docs/packs.md:
    // "Nothing is auto-registered under a bare name").
    expect(Object.hasOwn(registry, 'timeline')).toBe(false);
  });

  it('returns a null-prototype registry', () => {
    const registry = loadPack(anaManifest(), { timeline: entry() });
    expect(Object.getPrototypeOf(registry)).toBeNull();
  });

  it('returns an empty registry when the manifest engine is not react', () => {
    const manifest = anaManifest({ engine: 'vue' });
    const registry = loadPack(manifest, { timeline: entry() });
    expect(Object.keys(registry)).toHaveLength(0);
    expect(Object.hasOwn(registry, 'ana_timeline')).toBe(false);
  });

  it('skips a manifest component with no matching module instead of throwing', () => {
    const manifest = anaManifest({
      components: { timeline: './Timeline.tsx', map: './Map.tsx' },
    });
    const registry = loadPack(manifest, { timeline: entry() });
    expect(Object.hasOwn(registry, 'ana_timeline')).toBe(true);
    expect(Object.hasOwn(registry, 'ana_map')).toBe(false);
  });

  it('derives the entry inline flag from a declared kind: "inline"', () => {
    // Regression: pack-build's generated registration script used to stamp
    // every entry `inline: false`, which made a `kind: "inline"` pack
    // component render as the form-mismatch fallback when written in its
    // own declared form. The manifest's kind is authoritative here.
    const manifest = anaManifest({
      components: {
        badge: { source: './Badge.tsx', kind: 'inline' },
      },
    });
    const registry = loadPack(manifest, {
      badge: { component: stubComponent, inline: false },
    });
    expect(registry['ana_badge']?.inline).toBe(true);
    expect(registry['ana_badge']?.component).toBe(stubComponent);
  });

  it('derives inline: false from a declared block kind over the module flag', () => {
    const manifest = anaManifest({
      components: {
        timeline: { source: './Timeline.tsx', kind: 'container' },
      },
    });
    const registry = loadPack(manifest, {
      timeline: { component: stubComponent, inline: true },
    });
    expect(registry['ana_timeline']?.inline).toBe(false);
  });

  it('keeps the module inline flag when the manifest declares no kind', () => {
    const inlineModule: RegistryEntry = {
      component: stubComponent,
      inline: true,
    };
    const registry = loadPack(anaManifest(), { timeline: inlineModule });
    // No kind information: the registration renders unchanged (spec §4
    // rule 8), so the module keeps its own flag and its identity.
    expect(registry['ana_timeline']).toBe(inlineModule);
  });

  it('ignores a componentModules entry with no matching manifest component', () => {
    const registry = loadPack(anaManifest(), {
      timeline: entry(),
      stray: entry(),
    });
    expect(Object.hasOwn(registry, 'ana_timeline')).toBe(true);
    expect(Object.hasOwn(registry, 'ana_stray')).toBe(false);
  });

  it('never throws and registers nothing for a fully empty module map', () => {
    expect(() => loadPack(anaManifest(), {})).not.toThrow();
    const registry = loadPack(anaManifest(), {});
    expect(Object.keys(registry)).toHaveLength(0);
  });

  it('does not leak a prototype-inherited value from a hostile componentModules object', () => {
    // A plain object literal inherits from Object.prototype; `hasOwnProperty`
    // is itself a candidate directive-ish key someone might probe with, but
    // is unreachable as a manifest local name (validateLocalComponentName
    // rejects it upstream). More directly: an inherited, non-own property
    // must never satisfy the lookup even if it happens to share a name with
    // a real manifest component.
    const hostile = Object.create({
      timeline: entry(),
    }) as PackComponentModules;
    const registry = loadPack(anaManifest(), hostile);
    expect(Object.hasOwn(registry, 'ana_timeline')).toBe(false);
  });
});

describe('installPacks', () => {
  it('installs a single pack with no base registry', () => {
    const result = installPacks([
      { manifest: anaManifest(), componentModules: { timeline: entry() } },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.hasOwn(result.registry, 'ana_timeline')).toBe(true);
    }
  });

  it('merges installed packs on top of a base registry', () => {
    const base = createRegistry({ callout: entry() });
    const result = installPacks(
      [{ manifest: anaManifest(), componentModules: { timeline: entry() } }],
      base,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.hasOwn(result.registry, 'callout')).toBe(true);
      expect(Object.hasOwn(result.registry, 'ana_timeline')).toBe(true);
    }
  });

  it('rejects installing two packs with the same namespace', () => {
    const packA = {
      manifest: anaManifest({ components: { timeline: './Timeline.tsx' } }),
      componentModules: { timeline: entry() },
    };
    const packB = {
      manifest: anaManifest({ components: { map: './Map.tsx' } }),
      componentModules: { map: entry() },
    };
    const result = installPacks([packA, packB]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.collisions).toEqual(['ana']);
    }
  });

  it('installs nothing from either colliding pack, not a partial merge', () => {
    const packA = {
      manifest: anaManifest({ components: { timeline: './Timeline.tsx' } }),
      componentModules: { timeline: entry() },
    };
    const packB = {
      manifest: anaManifest({ components: { map: './Map.tsx' } }),
      componentModules: { map: entry() },
    };
    const base = createRegistry({ callout: entry() });
    const result = installPacks([packA, packB], base);
    expect(result.ok).toBe(false);
  });

  it('a non-react-engine pack among the set contributes an empty registry, not an error', () => {
    const reactPack = {
      manifest: anaManifest({ name: 'ana' }),
      componentModules: { timeline: entry() },
    };
    const vuePack = {
      manifest: anaManifest({ name: 'vega', engine: 'vue' }),
      componentModules: { chart: entry() },
    };
    const result = installPacks([reactPack, vuePack]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.hasOwn(result.registry, 'ana_timeline')).toBe(true);
      expect(Object.hasOwn(result.registry, 'vega_chart')).toBe(false);
    }
  });
});
