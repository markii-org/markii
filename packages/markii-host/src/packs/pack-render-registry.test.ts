import { describe, expect, it } from 'vitest';
import { createRegistry } from '@markii/react';
import { buildRenderRegistry } from './pack-render-registry.js';
import type { QueuedPackRegistration } from './pack-render-registry.js';

const VALID_MANIFEST = JSON.stringify({
  name: 'demo',
  engine: 'react',
  components: { badge: './Badge.tsx' },
});

function fakeComponent(): null {
  return null;
}

describe('buildRenderRegistry', () => {
  it('merges a valid registration into the base registry, namespaced', () => {
    const queued: QueuedPackRegistration[] = [
      {
        manifestJson: VALID_MANIFEST,
        componentModules: {
          badge: { component: fakeComponent, inline: false },
        },
      },
    ];
    const result = buildRenderRegistry(queued, createRegistry());
    expect(result.invalidReasons).toEqual([]);
    expect(result.collisions).toEqual([]);
    expect(result.registry['demo-badge']).toBeDefined();
  });

  it('an empty queue returns the base registry unchanged', () => {
    const base = createRegistry({ callout: { component: fakeComponent } });
    const result = buildRenderRegistry([], base);
    expect(result.registry).toBe(base);
  });

  it('a non-string manifestJson is dropped, with a reason recorded', () => {
    const queued: QueuedPackRegistration[] = [
      { manifestJson: 42, componentModules: {} },
    ];
    const result = buildRenderRegistry(queued, createRegistry());
    expect(result.invalidReasons).toHaveLength(1);
    expect(result.invalidReasons[0]).toContain('manifest JSON string');
    expect(Object.keys(result.registry)).toEqual([]);
  });

  it('an invalid manifest JSON is dropped, with a reason recorded', () => {
    const queued: QueuedPackRegistration[] = [
      { manifestJson: '{not json', componentModules: {} },
    ];
    const result = buildRenderRegistry(queued, createRegistry());
    expect(result.invalidReasons).toHaveLength(1);
    expect(result.invalidReasons[0]).toContain('manifest is invalid');
  });

  it('malformed componentModules (a poisoned entry) is dropped, with a reason recorded', () => {
    const queued: QueuedPackRegistration[] = [
      {
        manifestJson: VALID_MANIFEST,
        componentModules: { badge: { component: 'not a function' } },
      },
    ];
    const result = buildRenderRegistry(queued, createRegistry());
    expect(result.invalidReasons).toHaveLength(1);
    expect(result.invalidReasons[0]).toContain('malformed');
  });

  it('two registrations sharing a namespace reject the WHOLE install', () => {
    const queued: QueuedPackRegistration[] = [
      {
        manifestJson: VALID_MANIFEST,
        componentModules: { badge: { component: fakeComponent } },
      },
      {
        manifestJson: VALID_MANIFEST,
        componentModules: { badge: { component: fakeComponent } },
      },
    ];
    const base = createRegistry({ callout: { component: fakeComponent } });
    const result = buildRenderRegistry(queued, base);
    expect(result.collisions).toEqual(['demo']);
    expect(result.registry['demo-badge']).toBeUndefined();
    // Falls back to the base registry's own entries, not an empty one.
    expect(result.registry.callout).toBeDefined();
  });

  it('a componentModules object with a poisoned __proto__ key never installs a non-function as a component', () => {
    const hostile = JSON.parse('{"__proto__": {"component": "x"}}') as Record<
      string,
      unknown
    >;
    const queued: QueuedPackRegistration[] = [
      { manifestJson: VALID_MANIFEST, componentModules: hostile },
    ];
    const result = buildRenderRegistry(queued, createRegistry());
    expect(result.invalidReasons).toHaveLength(1);
    expect(result.registry['demo-badge']).toBeUndefined();
  });
});
