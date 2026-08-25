import { describe, expect, it } from 'vitest';
import { createPackModuleResolver } from './lua-resolver.js';
import type { PackModulesMap } from './lua-resolver.js';

const MODULES: PackModulesMap = {
  demo: {
    'http.lua': 'return { ok = true }',
    'nested/util.lua': 'return 1',
  },
};

describe('createPackModuleResolver', () => {
  it('resolves a bundle-jail-normalized module path, appending .lua', () => {
    const resolver = createPackModuleResolver(MODULES);
    expect(resolver('demo', 'http')).toBe('return { ok = true }');
    expect(resolver('demo', 'http.lua')).toBe('return { ok = true }');
    expect(resolver('demo', 'nested/util')).toBe('return 1');
  });

  it('returns undefined for an unconfigured pack namespace', () => {
    const resolver = createPackModuleResolver(MODULES);
    expect(resolver('nope', 'http')).toBeUndefined();
  });

  it('returns undefined for a missing module in a known pack', () => {
    const resolver = createPackModuleResolver(MODULES);
    expect(resolver('demo', 'missing')).toBeUndefined();
  });

  it('rejects path traversal cleanly instead of resolving outside the map', () => {
    const resolver = createPackModuleResolver(MODULES);
    expect(resolver('demo', '../http')).toBeUndefined();
    expect(resolver('demo', '../../etc/passwd')).toBeUndefined();
    expect(resolver('demo', '..')).toBeUndefined();
  });

  it('rejects an absolute path and a null byte', () => {
    const resolver = createPackModuleResolver(MODULES);
    expect(resolver('demo', '/etc/passwd')).toBeUndefined();
    expect(resolver('demo', 'http\0.lua')).toBeUndefined();
  });

  it('is immune to a __proto__/constructor-shaped pack name or module path', () => {
    const resolver = createPackModuleResolver(MODULES);
    expect(resolver('__proto__', 'x')).toBeUndefined();
    expect(resolver('constructor', 'x')).toBeUndefined();
    expect(resolver('demo', '__proto__')).toBeUndefined();
    expect(resolver('demo', 'constructor')).toBeUndefined();
  });

  it('never throws for hostile input', () => {
    const resolver = createPackModuleResolver(MODULES);
    expect(() => resolver('demo', '')).not.toThrow();
    expect(() => resolver('', '')).not.toThrow();
  });
});
