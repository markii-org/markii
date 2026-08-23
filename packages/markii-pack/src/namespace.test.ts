import { describe, expect, it } from 'vitest';
import {
  RESERVED_NAMESPACE_SEGMENTS,
  composeDirectiveName,
  detectNamespaceCollisions,
  validateLocalComponentName,
  validatePackName,
} from './namespace.js';

describe('validatePackName', () => {
  it('accepts a simple lowercase-kebab name', () => {
    expect(validatePackName('ana')).toEqual({ ok: true });
  });

  it('accepts a hyphenated name', () => {
    expect(validatePackName('ana-charts')).toEqual({ ok: true });
  });

  it('accepts a name with digits', () => {
    expect(validatePackName('ana2')).toEqual({ ok: true });
  });

  it('rejects non-string input', () => {
    expect(validatePackName(42).ok).toBe(false);
    expect(validatePackName(null).ok).toBe(false);
    expect(validatePackName(undefined).ok).toBe(false);
    expect(validatePackName({}).ok).toBe(false);
    expect(validatePackName([]).ok).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(validatePackName('').ok).toBe(false);
  });

  it('rejects a name containing ":"', () => {
    expect(validatePackName('ana:timeline').ok).toBe(false);
  });

  it('rejects each reserved bundle segment', () => {
    for (const segment of RESERVED_NAMESPACE_SEGMENTS) {
      const result = validatePackName(segment);
      expect(result.ok, `expected "${segment}" to be rejected`).toBe(false);
    }
  });

  it('rejects uppercase letters', () => {
    expect(validatePackName('Ana').ok).toBe(false);
  });

  it('rejects underscore', () => {
    expect(validatePackName('ana_charts').ok).toBe(false);
  });

  it('rejects a leading digit', () => {
    expect(validatePackName('2ana').ok).toBe(false);
  });

  it('rejects a leading or trailing hyphen', () => {
    expect(validatePackName('-ana').ok).toBe(false);
    expect(validatePackName('ana-').ok).toBe(false);
  });

  it('rejects a doubled hyphen', () => {
    expect(validatePackName('ana--charts').ok).toBe(false);
  });

  it('rejects a path-shaped name', () => {
    expect(validatePackName('../ana').ok).toBe(false);
    expect(validatePackName('ana/charts').ok).toBe(false);
  });

  it('rejects prototype-pollution-shaped names', () => {
    expect(validatePackName('__proto__').ok).toBe(false);
    expect(validatePackName('constructor').ok).toBe(false);
    expect(validatePackName('prototype').ok).toBe(false);
  });
});

describe('validateLocalComponentName', () => {
  it('accepts a simple lowercase-kebab name', () => {
    expect(validateLocalComponentName('timeline')).toEqual({ ok: true });
  });

  it('rejects non-string input', () => {
    expect(validateLocalComponentName(42).ok).toBe(false);
    expect(validateLocalComponentName(null).ok).toBe(false);
  });

  it('rejects ":"', () => {
    expect(validateLocalComponentName('time:line').ok).toBe(false);
  });

  it('rejects prototype-pollution-shaped names', () => {
    expect(validateLocalComponentName('__proto__').ok).toBe(false);
    expect(validateLocalComponentName('constructor').ok).toBe(false);
    expect(validateLocalComponentName('prototype').ok).toBe(false);
  });

  it('rejects uppercase and underscore', () => {
    expect(validateLocalComponentName('Timeline').ok).toBe(false);
    expect(validateLocalComponentName('time_line').ok).toBe(false);
  });
});

describe('composeDirectiveName', () => {
  it('composes with the default "-" separator', () => {
    expect(composeDirectiveName('ana', 'timeline')).toEqual({
      ok: true,
      name: 'ana-timeline',
    });
  });

  it('composes with an explicit "_" separator', () => {
    expect(composeDirectiveName('ana', 'timeline', '_')).toEqual({
      ok: true,
      name: 'ana_timeline',
    });
  });

  it('rejects when the pack name is invalid', () => {
    const result = composeDirectiveName('scripts', 'timeline');
    expect(result.ok).toBe(false);
  });

  it('rejects when the local name is invalid', () => {
    const result = composeDirectiveName('ana', '__proto__');
    expect(result.ok).toBe(false);
  });

  it('rejects when either input contains ":"', () => {
    expect(composeDirectiveName('ana:x', 'timeline').ok).toBe(false);
    expect(composeDirectiveName('ana', 'time:line').ok).toBe(false);
  });

  it('never produces a composed name containing ":"', () => {
    const result = composeDirectiveName('ana', 'timeline');
    if (result.ok) {
      expect(result.name.includes(':')).toBe(false);
    } else {
      throw new Error('expected a valid composition');
    }
  });
});

describe('detectNamespaceCollisions', () => {
  it('reports no collisions for unique namespaces', () => {
    expect(detectNamespaceCollisions(['ana', 'bea', 'cee'])).toEqual([]);
  });

  it('reports a duplicate namespace with its count', () => {
    expect(detectNamespaceCollisions(['ana', 'bea', 'ana'])).toEqual([
      { namespace: 'ana', count: 2 },
    ]);
  });

  it('reports multiple independent collisions', () => {
    const result = detectNamespaceCollisions([
      'ana',
      'ana',
      'bea',
      'bea',
      'bea',
    ]);
    const byNamespace = Object.fromEntries(
      result.map((c) => [c.namespace, c.count]),
    );
    expect(byNamespace).toEqual({ ana: 2, bea: 3 });
  });

  it('returns an empty array for an empty input', () => {
    expect(detectNamespaceCollisions([])).toEqual([]);
  });

  it('is case-sensitive', () => {
    // Not that "Ana" could ever pass validatePackName, but the predicate
    // itself must not silently normalize case.
    expect(detectNamespaceCollisions(['ana', 'Ana'])).toEqual([]);
  });
});
