import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parse } from '@markii/core';
import { createValueStore } from '@markii/runtime';
import { renderMark, renderMarkNode } from './render';
import {
  createRegistry,
  mergeRegistries,
  registryAliases,
  resolveDirectiveAlias,
  REGISTRY_ALIASES,
} from './registry';
import type {
  DirectiveAttributes,
  MarkComponentProps,
  Registry,
  RegistryAliases,
} from './registry';
import { defaultRegistry } from './components';

/**
 * A component that simply reports what it was handed, so a test can assert
 * on the exact attribute map a directive resolved to rather than on some
 * component's rendering of it.
 */
function Probe({ attributes, children }: MarkComponentProps) {
  return (
    <div data-testid="probe" data-attrs={JSON.stringify(attributes)}>
      {children}
    </div>
  );
}

/** Reports a resolved `data=` binding, for the preset-binding test below. */
function DataProbe({ data }: MarkComponentProps) {
  return <div data-testid="data">{String(data)}</div>;
}

function attributesOf(container: HTMLElement): DirectiveAttributes {
  const raw = container
    .querySelector('[data-testid="probe"]')
    ?.getAttribute('data-attrs');
  return raw ? (JSON.parse(raw) as DirectiveAttributes) : {};
}

/** The worked example: `warn` as shorthand for `callout{type=warning}`. */
const WARN_ALIASES: RegistryAliases = {
  warn: { name: 'callout', attributes: { type: 'warning' } },
};

const aliasedDefaults = createRegistry(defaultRegistry, WARN_ALIASES);

function renderDoc(text: string, registry: Registry = aliasedDefaults) {
  return render(renderMark(text, registry));
}

describe('registry aliases: the worked example (warn -> callout{type=warning})', () => {
  it('renders the target component with the preset attribute applied', () => {
    const { container } = renderDoc(':::warn\nMind the gap.\n:::');
    const callout = container.querySelector('.mk-callout--warning');
    expect(callout).not.toBeNull();
    expect(callout).toHaveTextContent('Mind the gap.');
  });

  it('produces byte-identical DOM to writing the target directive by hand', () => {
    const viaAlias = renderDoc(':::warn\nMind the gap.\n:::');
    const byHand = renderDoc(':::callout{type=warning}\nMind the gap.\n:::');
    expect(viaAlias.container.innerHTML).toBe(byHand.container.innerHTML);
  });

  it('lets an author-written attribute override the preset', () => {
    const { container } = renderDoc(':::warn{type=danger}\nBoom.\n:::');
    expect(container.querySelector('.mk-callout--danger')).not.toBeNull();
    expect(container.querySelector('.mk-callout--warning')).toBeNull();
  });

  it('keeps the author-written attributes alongside the preset', () => {
    const { container } = renderDoc(':::warn{title="Heads up"}\nBody.\n:::');
    const callout = container.querySelector('.mk-callout--warning');
    expect(callout).toHaveTextContent('Heads up');
  });

  it('leaves the unaliased document untouched', () => {
    const { container } = renderDoc(':::callout{type=info}\nPlain.\n:::');
    expect(container.querySelector('.mk-callout--info')).not.toBeNull();
  });

  it('renders nothing special for an alias name the registry does not define', () => {
    const { container } = renderDoc(':::warning\nNot an alias.\n:::');
    expect(container.querySelector('.mk-unknown')).not.toBeNull();
  });
});

describe('registry aliases: resolution rules', () => {
  const probeRegistry = createRegistry(
    { probe: { component: Probe }, callout: defaultRegistry.callout! },
    {
      pre: { name: 'probe', attributes: { a: 'from-alias', b: 'kept' } },
      bare: { name: 'probe' },
      chained: { name: 'pre' },
      missing: { name: 'nowhere' },
      callout: { name: 'probe' },
    },
  );

  it('passes preset attributes through to the target component', () => {
    const { container } = renderDoc('::pre', probeRegistry);
    expect(attributesOf(container)).toEqual({ a: 'from-alias', b: 'kept' });
  });

  it('lets author attributes win per key, keeping the rest of the preset', () => {
    const { container } = renderDoc('::pre{a=from-author}', probeRegistry);
    expect(attributesOf(container)).toEqual({ a: 'from-author', b: 'kept' });
  });

  it('supports an alias with no presets at all', () => {
    const { container } = renderDoc('::bare{x=1}', probeRegistry);
    expect(attributesOf(container)).toEqual({ x: '1' });
  });

  it('does NOT follow an alias-to-alias chain: it falls back on the target name', () => {
    const { container } = renderDoc('::chained', probeRegistry);
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback).not.toBeNull();
    expect(fallback).toHaveTextContent('pre');
    expect(container.querySelector('[data-testid="probe"]')).toBeNull();
  });

  it('falls back on the TARGET name when the target is not registered', () => {
    const { container } = renderDoc('::missing', probeRegistry);
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback).toHaveTextContent('nowhere');
    expect(fallback).not.toHaveTextContent('missing');
  });

  it('lets a real registered component win over an alias of the same name', () => {
    const { container } = renderDoc(':::callout{type=info}\nReal.\n:::');
    expect(container.querySelector('.mk-callout--info')).not.toBeNull();
    const shadowed = renderDoc(
      ':::callout{type=info}\nReal.\n:::',
      probeRegistry,
    );
    expect(
      shadowed.container.querySelector('.mk-callout--info'),
    ).not.toBeNull();
    expect(
      shadowed.container.querySelector('[data-testid="probe"]'),
    ).toBeNull();
  });

  it('lets an alias stand in for a name whose registry entry is broken', () => {
    // A half-loaded pack can leave an entry with no component; the renderer
    // already treats that as unknown, so the alias is the better answer.
    const broken = createRegistry(
      { probe: { component: Probe }, glitch: {} as never },
      { glitch: { name: 'probe' } },
    );
    const { container } = renderDoc('::glitch', broken);
    expect(container.querySelector('[data-testid="probe"]')).not.toBeNull();
  });

  it('applies to all three directive forms', () => {
    const inline = renderDoc('Text :pre[label] more.', probeRegistry);
    expect(attributesOf(inline.container)).toEqual({
      a: 'from-alias',
      b: 'kept',
    });
    const leaf = renderDoc('::pre{b=author}', probeRegistry);
    expect(attributesOf(leaf.container)).toEqual({
      a: 'from-alias',
      b: 'author',
    });
    const container = renderDoc(':::pre{b=author}\nBody.\n:::', probeRegistry);
    expect(attributesOf(container.container)).toEqual({
      a: 'from-alias',
      b: 'author',
    });
    expect(container.container).toHaveTextContent('Body.');
  });

  it('resolves a `data=` binding supplied by a preset, author still winning', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh' },
      forks: { value: 7, status: 'fresh' },
    });
    const registry = createRegistry(
      { probe: { component: DataProbe } },
      { bound: { name: 'probe', attributes: { data: 'stars' } } },
    );

    const preset = render(renderMark('::bound', registry, store));
    expect(
      preset.container.querySelector('[data-testid="data"]'),
    ).toHaveTextContent('42');

    const authored = render(renderMark('::bound{data=forks}', registry, store));
    expect(
      authored.container.querySelector('[data-testid="data"]'),
    ).toHaveTextContent('7');
  });

  it('is inert for an alias named `value` (the built-in wins)', () => {
    const registry = createRegistry(
      { probe: { component: Probe } },
      { value: { name: 'probe' } },
    );
    const { container } = renderDoc('The count is :value[stars].', registry);
    expect(container.querySelector('[data-testid="probe"]')).toBeNull();
    expect(container.querySelector('.mk-value')).not.toBeNull();
  });

  it('resolves identically through renderMarkNode', () => {
    const [node] = parse(':::warn\nMind the gap.\n:::').children;
    const viaNode = render(renderMarkNode(node!, aliasedDefaults));
    const viaDocument = renderDoc(':::warn\nMind the gap.\n:::');
    expect(viaNode.container.innerHTML).toBe(viaDocument.container.innerHTML);
  });

  it('is a pure lookup: resolveDirectiveAlias never mutates the registry', () => {
    const before = JSON.stringify(Object.keys(probeRegistry));
    resolveDirectiveAlias(probeRegistry, 'pre', {});
    resolveDirectiveAlias(probeRegistry, 'chained', {});
    expect(JSON.stringify(Object.keys(probeRegistry))).toBe(before);
    expect(registryAliases(probeRegistry)?.pre?.attributes).toEqual({
      a: 'from-alias',
      b: 'kept',
    });
  });
});

describe('registry aliases: reserved layout attributes in a preset', () => {
  const layoutRegistry = createRegistry(
    { probe: { component: Probe } },
    {
      framed: {
        name: 'probe',
        attributes: { width: 'wide', align: 'center', kept: 'yes' },
      },
      bogus: { name: 'probe', attributes: { width: 'javascript:alert(1)' } },
    },
  );

  it('intercepts a preset width/align exactly as if the author had written them', () => {
    const viaAlias = renderDoc('::framed', layoutRegistry);
    const byHand = renderDoc(
      '::probe{width=wide align=center kept=yes}',
      layoutRegistry,
    );
    expect(viaAlias.container.innerHTML).toBe(byHand.container.innerHTML);
    expect(
      viaAlias.container.querySelector('.mk-width-wide.mk-align-center'),
    ).not.toBeNull();
    // Reserved keys never reach the component, preset or not.
    expect(attributesOf(viaAlias.container)).toEqual({ kept: 'yes' });
  });

  it('lets an author-written width override a preset width', () => {
    const { container } = renderDoc('::framed{width=narrow}', layoutRegistry);
    expect(container.querySelector('.mk-width-narrow')).not.toBeNull();
    expect(container.querySelector('.mk-width-wide')).toBeNull();
  });

  it('drops an invalid preset width silently, with no class and no attribute', () => {
    const { container } = renderDoc('::bogus', layoutRegistry);
    expect(container.innerHTML).not.toContain('javascript:');
    expect(attributesOf(container)).toEqual({});
  });

  it('strips a preset layout key on an inline directive without wrapping it', () => {
    const { container } = renderDoc(
      'Text :framed[label] more.',
      layoutRegistry,
    );
    expect(container.querySelector('div.mk-width-wide')).toBeNull();
    expect(attributesOf(container)).toEqual({ kept: 'yes' });
  });
});

describe('registry aliases: hostile names and presets are inert', () => {
  it('does not resolve a prototype-flavored name through the prototype chain', () => {
    const registry = createRegistry({ probe: { component: Probe } }, {});
    // `__proto__` is deliberately absent here: it is not a legal directive
    // name in the first place (`remark-directive` requires an ASCII-alpha
    // start), so `::__proto__` never reaches the renderer as a directive at
    // all — see the dedicated test below. These four DO parse as directives.
    for (const name of [
      'constructor',
      'toString',
      'valueOf',
      'hasOwnProperty',
    ]) {
      const { container } = renderDoc(`::${name}`, registry);
      expect(container.querySelector('.mk-unknown')).not.toBeNull();
      expect(container.querySelector('[data-testid="probe"]')).toBeNull();
    }
  });

  it('resolves a prototype-flavored name to itself at the API level too', () => {
    const registry = createRegistry(
      { probe: { component: Probe } },
      { real: { name: 'probe' } },
    );
    for (const name of ['__proto__', 'constructor', 'toString', 'valueOf']) {
      expect(resolveDirectiveAlias(registry, name, {})).toEqual({
        name,
        attributes: {},
      });
    }
  });

  it('does not resolve a prototype-flavored name against a plain-object alias table', () => {
    // A host may hand-build a registry rather than use `createRegistry`;
    // the `Object.hasOwn` guard has to carry that case too.
    const registry: Registry = { probe: { component: Probe } };
    registry[REGISTRY_ALIASES] = { real: { name: 'probe' } };
    const { container } = renderDoc('::constructor', registry);
    expect(container.querySelector('.mk-unknown')).not.toBeNull();
  });

  it('treats an explicitly registered `__proto__` alias as unreachable, inert data', () => {
    const aliases = Object.create(null) as RegistryAliases;
    aliases['__proto__'] = { name: 'probe', attributes: { via: 'proto' } };
    const registry = createRegistry({ probe: { component: Probe } }, aliases);

    // A document can never address it: `::__proto__` is not directive
    // syntax, so it stays a paragraph — CommonMark reads the underscores as
    // strong emphasis — and no directive resolution happens at all.
    const { container } = renderDoc('::__proto__', registry);
    expect(container.querySelector('[data-testid="probe"]')).toBeNull();
    expect(container.querySelector('.mk-unknown')).toBeNull();
    expect(container.querySelector('p > strong')).toHaveTextContent('proto');

    // It is stored as an ordinary own property, not as a prototype: nothing
    // global was touched, and the registry itself stays null-prototype.
    expect(Object.getPrototypeOf(registryAliases(registry))).toBeNull();
    expect(({} as Record<string, unknown>).via).toBeUndefined();
    expect(Object.getPrototypeOf(registry)).toBeNull();
    // ...and it never leaks onto some other, unrelated name.
    expect(resolveDirectiveAlias(registry, 'nope', {})).toEqual({
      name: 'nope',
      attributes: {},
    });
  });

  it('cannot pollute Object.prototype through a preset key', () => {
    const attributes = JSON.parse(
      '{"__proto__": "polluted", "constructor": "also", "safe": "yes"}',
    ) as DirectiveAttributes;
    const registry = createRegistry(
      { probe: { component: Probe } },
      { hostile: { name: 'probe', attributes } },
    );
    const { container } = renderDoc('::hostile', registry);

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty('polluted')).toBe(false);
    const resolved = attributesOf(container);
    // `__proto__` is dropped by the assignment itself — exactly what happens
    // when an author writes it in the document — while `constructor`
    // survives as an inert own data property.
    expect(resolved).toEqual({ constructor: 'also', safe: 'yes' });
  });

  it('never throws on a malformed alias entry', () => {
    const aliases = {
      empty: { name: '' },
      nameless: {} as never,
      nulled: null as never,
      numeric: { name: 7 } as never,
    } satisfies Record<string, unknown> as RegistryAliases;
    const registry = createRegistry({ probe: { component: Probe } }, aliases);
    for (const name of ['empty', 'nameless', 'nulled', 'numeric']) {
      const { container } = renderDoc(`::${name}`, registry);
      const fallback = container.querySelector('.mk-unknown');
      expect(fallback).not.toBeNull();
      expect(fallback).toHaveTextContent(name);
    }
  });

  it('never throws on a self-referential alias', () => {
    const registry = createRegistry(
      { probe: { component: Probe } },
      { loop: { name: 'loop' } },
    );
    const { container } = renderDoc('::loop', registry);
    expect(container.querySelector('.mk-unknown')).toHaveTextContent('loop');
  });
});

describe('registry aliases: createRegistry and mergeRegistries', () => {
  it('attaches a null-prototype alias table', () => {
    const registry = createRegistry({}, WARN_ALIASES);
    const aliases = registryAliases(registry);
    expect(Object.getPrototypeOf(aliases)).toBeNull();
    expect(aliases?.warn?.name).toBe('callout');
  });

  it('leaves an alias-free registry alias-free', () => {
    expect(registryAliases(createRegistry({}))).toBeUndefined();
    expect(registryAliases(mergeRegistries({}, {}))).toBeUndefined();
  });

  it('keeps aliases already carried by the entries it is seeded from', () => {
    const seeded = createRegistry(createRegistry({}, WARN_ALIASES));
    expect(registryAliases(seeded)?.warn?.name).toBe('callout');
  });

  it('does not expose the alias table as a directive name', () => {
    const registry = createRegistry(
      { probe: { component: Probe } },
      WARN_ALIASES,
    );
    expect(Object.keys(registry)).toEqual(['probe']);
    expect(JSON.stringify(registry)).toBe('{"probe":{}}');
  });

  it('merges alias tables per name rather than wholesale', () => {
    const a = createRegistry({}, { one: { name: 'callout' } });
    const b = createRegistry({}, { two: { name: 'card' } });
    const merged = registryAliases(mergeRegistries(a, b));
    expect(merged?.one?.name).toBe('callout');
    expect(merged?.two?.name).toBe('card');
  });

  it('gives the last registry precedence on an alias-name collision', () => {
    const a = createRegistry({}, { shared: { name: 'callout' } });
    const b = createRegistry({}, { shared: { name: 'card' } });
    const c = createRegistry({}, { shared: { name: 'badge' } });
    expect(registryAliases(mergeRegistries(a, b, c))?.shared?.name).toBe(
      'badge',
    );
  });

  it('keeps earlier aliases when a later registry defines only components', () => {
    const withAlias = createRegistry({}, WARN_ALIASES);
    const componentsOnly: Registry = { probe: { component: Probe } };
    const merged = mergeRegistries(withAlias, componentsOnly);
    expect(registryAliases(merged)?.warn?.name).toBe('callout');
    expect(merged.probe?.component).toBe(Probe);
  });

  it('renders through a merged registry end to end', () => {
    const merged = mergeRegistries(
      defaultRegistry,
      createRegistry({}, WARN_ALIASES),
    );
    const { container } = renderDoc(':::warn\nMerged.\n:::', merged);
    expect(container.querySelector('.mk-callout--warning')).not.toBeNull();
  });
});
