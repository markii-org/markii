import { describe, expect, it } from 'vitest';
import {
  createRegistry,
  mergeRegistries,
  readRegistryLayoutAxis,
  registryLayoutAxis,
} from './registry';
import type { Registry, MarkComponentProps } from './registry';

function stubComponent(_props: MarkComponentProps): null {
  return null;
}

describe('createRegistry', () => {
  it('returns a null-prototype map', () => {
    const registry = createRegistry();
    expect(Object.getPrototypeOf(registry)).toBeNull();
  });

  it('returns a null-prototype map even when seeded with entries', () => {
    const registry = createRegistry({
      probe: { component: stubComponent },
    });
    expect(Object.getPrototypeOf(registry)).toBeNull();
    expect(registry.probe?.component).toBe(stubComponent);
  });
});

describe('mergeRegistries', () => {
  it('returns a null-prototype map', () => {
    const merged = mergeRegistries(createRegistry(), createRegistry());
    expect(Object.getPrototypeOf(merged)).toBeNull();
  });

  it('returns a null-prototype map even when merging plain-object registries', () => {
    // `Registry` is a plain `Record`, so callers are free to pass plain
    // object literals (not just `createRegistry()` output) — the merge
    // result must still come out null-prototype either way.
    const a: Registry = { one: { component: stubComponent } };
    const b: Registry = { two: { component: stubComponent } };
    const merged = mergeRegistries(a, b);
    expect(Object.getPrototypeOf(merged)).toBeNull();
  });

  it('preserves entries present in only one registry', () => {
    const a: Registry = { one: { component: stubComponent, inline: true } };
    const b: Registry = { two: { component: stubComponent, inline: false } };
    const merged = mergeRegistries(a, b);
    expect(merged.one).toEqual({ component: stubComponent, inline: true });
    expect(merged.two).toEqual({ component: stubComponent, inline: false });
  });

  it('lets later registries override entries from earlier ones on name collision', () => {
    function earlierComponent(_props: MarkComponentProps): null {
      return null;
    }
    function laterComponent(_props: MarkComponentProps): null {
      return null;
    }
    const a: Registry = { shared: { component: earlierComponent } };
    const b: Registry = { shared: { component: laterComponent } };
    const merged = mergeRegistries(a, b);
    expect(merged.shared?.component).toBe(laterComponent);
  });

  it('takes the last registry as authoritative across more than two inputs', () => {
    function first(_props: MarkComponentProps): null {
      return null;
    }
    function second(_props: MarkComponentProps): null {
      return null;
    }
    function third(_props: MarkComponentProps): null {
      return null;
    }
    const merged = mergeRegistries(
      { shared: { component: first } },
      { shared: { component: second } },
      { shared: { component: third } },
    );
    expect(merged.shared?.component).toBe(third);
  });
});

describe('readRegistryLayoutAxis', () => {
  it('reads a declared axis', () => {
    expect(
      readRegistryLayoutAxis({ component: stubComponent, layout: 'align' }),
    ).toBe('align');
    expect(
      readRegistryLayoutAxis({ component: stubComponent, layout: 'width' }),
    ).toBe('width');
  });

  it('returns undefined for an entry that declares none, or no entry at all', () => {
    expect(
      readRegistryLayoutAxis({ component: stubComponent }),
    ).toBeUndefined();
    expect(readRegistryLayoutAxis(undefined)).toBeUndefined();
  });

  it('ignores a value that is not one of the two axis names', () => {
    // Same posture as an invalid `width=`: a mistake reads as "ordinary
    // component", never as an arbitrary string reaching the renderer.
    const entry = { component: stubComponent, layout: 'sideways' } as unknown;
    expect(
      readRegistryLayoutAxis(entry as { component: typeof stubComponent }),
    ).toBeUndefined();
  });

  it('degrades to undefined when the read itself throws (hostile registry configuration)', () => {
    const entry = { component: stubComponent };
    Object.defineProperty(entry, 'layout', {
      get() {
        throw new Error('hostile getter');
      },
    });
    expect(() => readRegistryLayoutAxis(entry)).not.toThrow();
    expect(readRegistryLayoutAxis(entry)).toBeUndefined();
  });
});

describe('registryLayoutAxis', () => {
  it('finds a layout scope by name', () => {
    const registry = createRegistry({
      scope: { component: stubComponent, layout: 'align' },
    });
    expect(registryLayoutAxis(registry, 'scope')).toBe('align');
  });

  it('misses a prototype member name rather than resolving through the chain', () => {
    const registry: Registry = { real: { component: stubComponent } };
    for (const name of ['constructor', '__proto__', 'toString', 'valueOf']) {
      expect(registryLayoutAxis(registry, name), name).toBeUndefined();
    }
  });

  it('a broken entry is not a layout scope, so its width/align still reach the ordinary wrapper', () => {
    const registry = {
      broken: { component: undefined, layout: 'align' },
    } as unknown as Registry;
    expect(registryLayoutAxis(registry, 'broken')).toBeUndefined();
  });
});
