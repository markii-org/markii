import { describe, expect, it } from 'vitest';
import {
  createAnsiRegistry,
  mergeAnsiRegistries,
  readRegistryComponent,
  registryAliases,
  registryLayoutAxis,
  resolveDirectiveAlias,
  type AnsiComponent,
  type AnsiRegistry,
  type AnsiRegistryEntry,
} from './registry.js';

const echo: AnsiComponent = ({ children }) => children;

describe('createAnsiRegistry / mergeAnsiRegistries', () => {
  it('creates a null-prototype registry', () => {
    const registry = createAnsiRegistry({ box: { component: echo } });
    expect(Object.getPrototypeOf(registry)).toBeNull();
  });

  it('merges alias tables per name, later registries winning', () => {
    const a = createAnsiRegistry(
      { box: { component: echo } },
      {
        alias1: { name: 'box' },
      },
    );
    const b = createAnsiRegistry(
      { card: { component: echo } },
      {
        alias2: { name: 'card' },
      },
    );
    const merged = mergeAnsiRegistries(a, b);
    expect(registryAliases(merged)).toEqual({
      alias1: { name: 'box' },
      alias2: { name: 'card' },
    });
  });

  it('a later registry wins for the same name', () => {
    const first: AnsiComponent = () => 'first';
    const second: AnsiComponent = () => 'second';
    const merged = mergeAnsiRegistries(
      createAnsiRegistry({ box: { component: first } }),
      createAnsiRegistry({ box: { component: second } }),
    );
    expect(
      readRegistryComponent(merged.box)?.({
        attributes: {},
        children: '',
        ctx: {} as never,
      }),
    ).toBe('second');
  });
});

describe('resolveDirectiveAlias', () => {
  it('a real component wins over any alias of the same name', () => {
    const registry = createAnsiRegistry(
      { box: { component: echo } },
      { box: { name: 'card' } },
    );
    expect(resolveDirectiveAlias(registry, 'box', {})).toEqual({
      name: 'box',
      attributes: {},
    });
  });

  it('an unaliased name passes through unchanged', () => {
    const registry = createAnsiRegistry({ box: { component: echo } });
    expect(resolveDirectiveAlias(registry, 'mystery', { a: '1' })).toEqual({
      name: 'mystery',
      attributes: { a: '1' },
    });
  });

  it("follows an alias exactly one hop, merging preset attributes under the author's", () => {
    const registry = createAnsiRegistry(
      { box: { component: echo } },
      { warn: { name: 'box', attributes: { type: 'warning', title: 'x' } } },
    );
    expect(resolveDirectiveAlias(registry, 'warn', { title: 'mine' })).toEqual({
      name: 'box',
      attributes: { type: 'warning', title: 'mine' },
    });
  });

  it('a malformed alias (empty/non-string name) degrades to the unaliased path', () => {
    const registry = createAnsiRegistry({}, { bad: { name: '' } });
    expect(resolveDirectiveAlias(registry, 'bad', {})).toEqual({
      name: 'bad',
      attributes: {},
    });
  });
});

describe('hostile registry configuration never throws', () => {
  it('a directive named "constructor" resolves through the null-prototype map, not Object.prototype', () => {
    const registry = createAnsiRegistry({ constructor: { component: echo } });
    // Bracket access via a non-literal key, so TypeScript resolves the
    // registry's index signature instead of `Object.prototype`'s own
    // `constructor: Function` declaration for the literal property name.
    const key: string = 'constructor';
    const entry: AnsiRegistryEntry | undefined = (
      registry as unknown as Record<string, AnsiRegistryEntry>
    )[key];
    expect(readRegistryComponent(entry)).toBe(echo);
  });

  it('degrades to undefined when reading .component throws (a hostile getter)', () => {
    const entry = {
      get component(): never {
        throw new Error('hostile getter');
      },
    };
    const registry = createAnsiRegistry({ box: entry as never });
    expect(readRegistryComponent(registry.box)).toBeUndefined();
  });

  it("a non-function component is returned as-is by readRegistryComponent (the caller's own component() call is what would throw, and render.tsx contains that)", () => {
    const registry = createAnsiRegistry({
      box: { component: 'not a function' as unknown as AnsiComponent },
    });
    expect(readRegistryComponent(registry.box)).toBe('not a function');
  });

  it('a frozen registry entry is read without throwing', () => {
    const entry = Object.freeze({ component: echo });
    const registry = createAnsiRegistry({ box: entry });
    expect(readRegistryComponent(registry.box)).toBe(echo);
  });

  it('a Proxy-wrapped entry with a throwing trap degrades to undefined, never throwing', () => {
    const hostile = new Proxy(
      { component: echo },
      {
        get(): never {
          throw new Error('proxy trap exploded');
        },
      },
    );
    const registry: AnsiRegistry = createAnsiRegistry({
      box: hostile as never,
    });
    expect(readRegistryComponent(registry.box)).toBeUndefined();
  });

  it('registryLayoutAxis degrades to undefined for a hostile .layout getter', () => {
    const entry = {
      component: echo,
      get layout(): never {
        throw new Error('boom');
      },
    };
    const registry = createAnsiRegistry({ center: entry as never });
    expect(registryLayoutAxis(registry, 'center')).toBeUndefined();
  });

  it('registryLayoutAxis ignores an invalid axis value', () => {
    const registry = createAnsiRegistry({
      center: { component: echo, layout: 'diagonal' as never },
    });
    expect(registryLayoutAxis(registry, 'center')).toBeUndefined();
  });
});
