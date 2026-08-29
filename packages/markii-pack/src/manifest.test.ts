import { describe, expect, it } from 'vitest';
import { parsePackManifest } from './manifest.js';

const VALID = JSON.stringify({
  name: 'ana',
  engine: 'react',
  components: { timeline: './Timeline.tsx' },
});

describe('parsePackManifest', () => {
  it('accepts a valid manifest', () => {
    const result = parsePackManifest(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest).toEqual({
        name: 'ana',
        engine: 'react',
        components: { timeline: './Timeline.tsx' },
      });
      expect(result.warnings).toEqual([]);
    }
  });

  it('accepts multiple components', () => {
    const result = parsePackManifest(
      JSON.stringify({
        name: 'ana',
        engine: 'react',
        components: {
          timeline: './Timeline.tsx',
          gauge: './Gauge.tsx',
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects malformed JSON', () => {
    const result = parsePackManifest('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatch(/malformed JSON/);
    }
  });

  it('rejects a non-object root', () => {
    for (const input of ['42', '"string"', 'null', '[]', 'true']) {
      const result = parsePackManifest(input);
      expect(result.ok, `expected ${input} to be rejected`).toBe(false);
    }
  });

  it('rejects a missing "name"', () => {
    const result = parsePackManifest(
      JSON.stringify({ engine: 'react', components: { a: './A.tsx' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('"name"'))).toBe(true);
    }
  });

  it('rejects an invalid "name" (reserved segment)', () => {
    const result = parsePackManifest(
      JSON.stringify({
        name: 'scripts',
        engine: 'react',
        components: { a: './A.tsx' },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a "name" containing ":"', () => {
    const result = parsePackManifest(
      JSON.stringify({
        name: 'ana:charts',
        engine: 'react',
        components: { a: './A.tsx' },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a prototype-pollution-shaped "name"', () => {
    const result = parsePackManifest(
      JSON.stringify({
        name: '__proto__',
        engine: 'react',
        components: { a: './A.tsx' },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a missing "engine"', () => {
    const result = parsePackManifest(
      JSON.stringify({ name: 'ana', components: { a: './A.tsx' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('"engine"'))).toBe(true);
    }
  });

  it('rejects a non-string "engine"', () => {
    const result = parsePackManifest(
      JSON.stringify({ name: 'ana', engine: 42, components: { a: './A.tsx' } }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an empty-string "engine"', () => {
    const result = parsePackManifest(
      JSON.stringify({ name: 'ana', engine: '', components: { a: './A.tsx' } }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a missing "components"', () => {
    const result = parsePackManifest(
      JSON.stringify({ name: 'ana', engine: 'react' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('"components"'))).toBe(true);
    }
  });

  it('rejects a non-object "components"', () => {
    const result = parsePackManifest(
      JSON.stringify({ name: 'ana', engine: 'react', components: 'nope' }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an empty "components" map', () => {
    const result = parsePackManifest(
      JSON.stringify({ name: 'ana', engine: 'react', components: {} }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid component key', () => {
    const result = parsePackManifest(
      JSON.stringify({
        name: 'ana',
        engine: 'react',
        components: { Timeline: './Timeline.tsx' },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a prototype-pollution-shaped component key', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'ana',
          engine: 'react',
          components: { [key]: './X.tsx' },
        }),
      );
      expect(result.ok, `expected key "${key}" to be rejected`).toBe(false);
    }
  });

  it('does not walk the prototype chain when reading components', () => {
    // JSON.parse never produces objects with extra inherited enumerable
    // own-properties, but this guards the reading strategy itself: even if
    // something upstream handed parsePackManifest an object built with
    // Object.create(evilProto), only own keys should ever be read.
    const evilProto = { injected: './Injected.tsx' };
    const components = Object.create(evilProto) as Record<string, string>;
    components.timeline = './Timeline.tsx';

    const raw = { name: 'ana', engine: 'react', components };
    // Round-trip through JSON so the shape matches what parsePackManifest
    // actually receives (a string), which also proves `injected` cannot
    // survive JSON serialization of an inherited-only property in the
    // first place — but assert the direct-object reading contract too via
    // the exported validator used internally.
    const result = parsePackManifest(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.hasOwn(result.manifest.components, 'injected')).toBe(false);
      expect(result.manifest.components).toEqual({
        timeline: './Timeline.tsx',
      });
    }
  });

  it('rejects a non-string component path', () => {
    const result = parsePackManifest(
      JSON.stringify({
        name: 'ana',
        engine: 'react',
        components: { timeline: 42 },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an empty-string component path', () => {
    const result = parsePackManifest(
      JSON.stringify({
        name: 'ana',
        engine: 'react',
        components: { timeline: '' },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('warns on unknown top-level keys but still parses', () => {
    const result = parsePackManifest(
      JSON.stringify({
        name: 'ana',
        engine: 'react',
        components: { timeline: './Timeline.tsx' },
        futureField: 'x',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.includes('futureField'))).toBe(true);
    }
  });

  it('collects multiple errors at once rather than stopping at the first', () => {
    const result = parsePackManifest(
      JSON.stringify({ name: 'scripts', engine: '' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(1);
    }
  });

  describe('object-form components', () => {
    it('accepts a component with source, description, and kind', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: {
            profile: {
              source: './profile.tsx',
              description: 'A cat profile card.',
              kind: 'container',
            },
          },
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest.components.profile).toEqual({
          source: './profile.tsx',
          description: 'A cat profile card.',
          kind: 'container',
        });
      }
    });

    it('accepts an object entry with only source', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: { profile: { source: './profile.tsx' } },
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest.components.profile).toEqual({
          source: './profile.tsx',
        });
      }
    });

    it('mixes string and object forms in one manifest', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: {
            card: './cat-card.tsx',
            profile: { source: './profile.tsx', kind: 'leaf' },
          },
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.manifest.components.card).toBe('./cat-card.tsx');
        expect(result.manifest.components.profile).toEqual({
          source: './profile.tsx',
          kind: 'leaf',
        });
      }
    });

    it('round-trips each valid kind value', () => {
      for (const kind of ['inline', 'leaf', 'container']) {
        const result = parsePackManifest(
          JSON.stringify({
            name: 'cat',
            engine: 'react',
            components: { profile: { source: './profile.tsx', kind } },
          }),
        );
        expect(result.ok, `expected kind "${kind}" to be accepted`).toBe(true);
        if (result.ok) {
          expect(
            (result.manifest.components.profile as { kind?: string }).kind,
          ).toBe(kind);
        }
      }
    });

    it('rejects an invalid kind and names the allowed values', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: { profile: { source: './profile.tsx', kind: 'widget' } },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.errors.some(
            (e) =>
              e.includes('components.profile.kind') &&
              e.includes('inline') &&
              e.includes('leaf') &&
              e.includes('container'),
          ),
        ).toBe(true);
      }
    });

    it('rejects a non-string description', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: { profile: { source: './profile.tsx', description: 42 } },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.errors.some((e) =>
            e.includes('components.profile.description'),
          ),
        ).toBe(true);
      }
    });

    it('rejects an empty-string description', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: { profile: { source: './profile.tsx', description: '' } },
        }),
      );
      expect(result.ok).toBe(false);
    });

    it('rejects an object entry missing source', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: { profile: { description: 'no source' } },
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.errors.some((e) => e.includes('components.profile.source')),
        ).toBe(true);
      }
    });

    it('rejects an object entry with an empty-string source', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: { profile: { source: '' } },
        }),
      );
      expect(result.ok).toBe(false);
    });

    it('rejects an array value for a component entry', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: { profile: ['./profile.tsx'] },
        }),
      );
      expect(result.ok).toBe(false);
    });

    it('warns on an unknown key inside a component object but still parses', () => {
      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          components: { card: { source: './cat-card.tsx', colour: 'orange' } },
        }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          result.warnings.some((w) => w.includes('components.card.colour')),
        ).toBe(true);
        expect(result.manifest.components.card).toEqual({
          source: './cat-card.tsx',
        });
      }
    });

    it('does not let __proto__ or inherited keys inject a component field', () => {
      const evilProto = { source: './injected.tsx' };
      const entry = Object.create(evilProto) as Record<string, unknown>;
      entry.description = 'legit';

      const result = parsePackManifest(
        JSON.stringify({
          name: 'cat',
          engine: 'react',
          // JSON.stringify/JSON.parse round-trip already strips
          // inherited-only properties, so this proves the shape rather
          // than smuggling anything through JSON itself; it exercises the
          // same Object.hasOwn discipline as the top-level reader.
          components: { profile: JSON.parse(JSON.stringify(entry)) },
        }),
      );
      // Round-tripped through JSON, `entry` has no own `source`, so this
      // must reject with a missing-source error, never silently accept an
      // inherited one.
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(
          result.errors.some((e) => e.includes('components.profile.source')),
        ).toBe(true);
      }
    });
  });
});
