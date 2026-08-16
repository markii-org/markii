import { describe, expect, it } from 'vitest';
import { createRegistry, mergeRegistries } from './registry';
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
