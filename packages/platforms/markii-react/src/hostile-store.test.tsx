import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parse } from '@markii/core';
import type { StoredValue, ValueStore, VaultStore } from '@markii/runtime';
import { renderMark, renderMarkNode } from './render';
import { resolveScopedPath, resolveStorePath } from './store-path';
import { defaultRegistry } from './components/index';

/**
 * The never-throw guarantee against a HOSTILE OR BUGGY HOST STORE.
 *
 * `renderMark`/`renderMarkNode` promise never to throw, but their own
 * `try`/`catch` only covers parse + hast conversion — a `data=`/`:value[...]`
 * binding is resolved LATER, inside `DirectiveElement`/`ValueDirective`,
 * during React's render phase, where a throw escapes the entry point
 * entirely. A `ValueStore`/`VaultStore` is host-supplied: typed at compile
 * time, arbitrary third-party code at runtime. These tests pin that every
 * way it can misbehave degrades to the ordinary missing resolution instead.
 *
 * Two layers are covered, because a hostile value reaches the page through
 * two different doors:
 * - the RESOLUTION layer (store/vault `get`, reading a returned entry, and
 *   the dotted-path walk) — `./store-path`;
 * - the REFERENCE data-bound components (`stat`/`progress`/`chart`), which a
 *   BARE (non-dotted) name hands the raw value to untouched, and which guard
 *   their own reads with `safeRead` (`./safe-data`).
 *
 * The boundary: a THIRD-PARTY registry component that throws while reading
 * its own `data` prop stays the embedding app's to guard — the renderer
 * cannot reach inside someone else's component. The standard set is ours, so
 * it has to exemplify the contract rather than rely on that exemption.
 */

function boom(): never {
  throw new Error('store exploded');
}

function fresh(value: unknown): StoredValue {
  return { value, status: 'fresh' };
}

/** A `ValueStore` whose every method throws. */
function throwingStore(): ValueStore {
  return {
    get: () => boom(),
    has: () => boom(),
    set: () => boom(),
    snapshot: () => boom(),
  };
}

/** A `VaultStore` whose every method throws. */
function throwingVault(): VaultStore {
  return { get: () => boom(), has: () => boom(), snapshot: () => boom() };
}

/** A minimal read-only store over a plain map, so a test can seat a deliberately hostile `StoredValue` that `createValueStore` would never produce. */
function storeOf(map: Record<string, StoredValue>): ValueStore {
  return {
    get: (name) => (Object.hasOwn(map, name) ? map[name] : undefined),
    has: (name) => Object.hasOwn(map, name),
    set: () => undefined,
    snapshot: () => ({ ...map }),
  };
}

function vaultOf(map: Record<string, StoredValue>): VaultStore {
  return {
    get: (name) => (Object.hasOwn(map, name) ? map[name] : undefined),
    has: (name) => Object.hasOwn(map, name),
    snapshot: () => ({ ...map }),
  };
}

/** A revoked `Proxy`: `Object.hasOwn` and every property read on it throw a `TypeError`. */
function revokedProxy(): unknown {
  const { proxy, revoke } = Proxy.revocable({ stars: 1 }, {});
  revoke();
  return proxy;
}

/** A `Proxy` whose `get`/`has`/`getOwnPropertyDescriptor` traps all throw — exactly the traps a dotted-path walk exercises. */
function trapBombProxy(): unknown {
  return new Proxy(
    { stars: 1 },
    {
      get: () => boom(),
      has: () => boom(),
      getOwnPropertyDescriptor: () => boom(),
      ownKeys: () => boom(),
    },
  );
}

/**
 * An array-like `Proxy` that reads normally up to `index` and then throws —
 * the shape that survives an `Array.isArray` check and only detonates
 * partway through iteration, so a guard placed at the wrong granularity
 * (per-check rather than per-extraction) would still let it through.
 */
function explodingAtIndex(index: number): unknown {
  const backing = Array.from({ length: 20 }, (_, i) => i);
  return new Proxy(backing, {
    get(target, key, receiver): unknown {
      if (typeof key === 'string' && Number(key) >= index) boom();
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
}

/** An entry whose `value` getter succeeds once and throws on every later read — the "works in the probe, explodes in the render" shape. */
function secondReadThrows(): StoredValue {
  let reads = 0;
  return {
    get value(): unknown {
      reads += 1;
      if (reads > 1) throw new Error('second read explodes');
      return { stars: 1 };
    },
    status: 'fresh',
  };
}

describe('resolveStorePath — hostile host store never throws', () => {
  it('a store whose get() throws degrades to missing, carrying the message in the tooltip channel', () => {
    const result = resolveStorePath(throwingStore(), 'x');
    expect(result).toEqual({
      value: undefined,
      status: 'missing',
      error: 'store exploded',
    });
    expect(result.failureKind).toBeUndefined();
  });

  it('a store whose get() throws degrades identically for a dotted path', () => {
    expect(resolveStorePath(throwingStore(), 'x.y.z')).toEqual({
      value: undefined,
      status: 'missing',
      error: 'store exploded',
    });
  });

  it('a store that is itself a hostile proxy (get is not even reachable) degrades to missing', () => {
    const store = new Proxy({}, { get: () => boom() }) as ValueStore;
    expect(resolveStorePath(store, 'x').status).toBe('missing');
  });

  it('an entry whose value getter throws on the second read degrades to missing', () => {
    // First read happens inside `readEntry`; the walk then uses the value it
    // already captured, so this must not blow up mid-walk either.
    const store = storeOf({ x: secondReadThrows() });
    expect(() => resolveStorePath(store, 'x.stars')).not.toThrow();
    expect(() => resolveStorePath(store, 'x')).not.toThrow();
  });

  it('an entry whose error getter throws degrades to missing rather than propagating', () => {
    const store = storeOf({
      x: {
        value: 1,
        status: 'fresh',
        get error(): string {
          throw new Error('error getter explodes');
        },
      },
    });
    expect(resolveStorePath(store, 'x')).toEqual({
      value: undefined,
      status: 'missing',
      error: 'error getter explodes',
    });
  });

  it('an entry that is itself a revoked proxy degrades to missing', () => {
    const store = storeOf({ x: revokedProxy() as StoredValue });
    expect(resolveStorePath(store, 'x').status).toBe('missing');
    expect(resolveStorePath(store, 'x.stars').status).toBe('missing');
  });

  it('a revoked proxy STORED VALUE degrades to missing on the dotted-path walk', () => {
    const store = storeOf({ x: fresh(revokedProxy()) });
    const result = resolveStorePath(store, 'x.stars');
    expect(result.status).toBe('missing');
    expect(result.value).toBeUndefined();
    expect(typeof result.error).toBe('string');
  });

  it('a stored value with throwing has/get traps degrades to missing on the walk', () => {
    const store = storeOf({ x: fresh(trapBombProxy()) });
    expect(resolveStorePath(store, 'x.stars')).toEqual({
      value: undefined,
      status: 'missing',
      error: 'store exploded',
    });
  });

  it('a trap bomb nested deep in an otherwise plain object degrades to missing', () => {
    const store = storeOf({ x: fresh({ a: { b: trapBombProxy() } }) });
    expect(resolveStorePath(store, 'x.a.b.c').status).toBe('missing');
  });

  it('a bare-name lookup of a hostile stored value never touches it, so it resolves normally', () => {
    // No walk means no property access: the value is handed on untouched,
    // exactly as a plain value would be. The resolver's job is to not throw,
    // not to sanitize whatever a host chose to store.
    const hostile = trapBombProxy();
    const store = storeOf({ x: fresh(hostile) });
    const result = resolveStorePath(store, 'x');
    // Identity comparison only — a deep `toEqual` would itself trip the
    // proxy's traps, which is the whole point: nothing may touch this value.
    expect(result.value).toBe(hostile);
    expect(result.status).toBe('fresh');
    expect(result.error).toBeUndefined();
  });

  it('an off-contract status degrades to missing instead of flowing on as a freshness', () => {
    const store = storeOf({ x: { value: 1, status: 'weird' as never } });
    expect(resolveStorePath(store, 'x').status).toBe('missing');
  });

  it('a non-string error is dropped rather than passed on to a title attribute', () => {
    const store = storeOf({
      x: { value: null, status: 'error', error: { bad: 1 } as never },
    });
    expect(resolveStorePath(store, 'x').error).toBeUndefined();
  });

  it('a non-string failureKind is dropped, while an out-of-taxonomy STRING still passes through', () => {
    const objectKind = storeOf({
      x: {
        value: null,
        status: 'error',
        failureKind: new Proxy({}, { get: () => boom() }) as never,
      },
    });
    expect(resolveStorePath(objectKind, 'x').failureKind).toBeUndefined();

    const stringKind = storeOf({
      x: { value: null, status: 'error', failureKind: 'not-a-kind' as never },
    });
    expect(resolveStorePath(stringKind, 'x').failureKind).toBe('not-a-kind');
  });

  it('a thrown non-Error, including one that cannot be stringified, still yields a string message', () => {
    const store: ValueStore = {
      get: () => {
        throw revokedProxy();
      },
      has: () => false,
      set: () => undefined,
      snapshot: () => ({}),
    };
    const result = resolveStorePath(store, 'x');
    expect(result.status).toBe('missing');
    expect(result.error).toBe('value store threw while reading this name');
  });
});

describe('resolveScopedPath — hostile vault store never throws', () => {
  it('a vault whose get() throws degrades to missing, bare and dotted alike', () => {
    const vault = throwingVault();
    expect(resolveScopedPath({ vault }, '@x')).toEqual({
      value: undefined,
      status: 'missing',
      error: 'store exploded',
    });
    expect(resolveScopedPath({ vault }, '@x.y').status).toBe('missing');
  });

  it('a hostile vault never leaks into the note-local scope', () => {
    const store = storeOf({ x: fresh(1) });
    expect(
      resolveScopedPath({ store, vault: throwingVault() }, '@x').value,
    ).toBe(undefined);
    // ...and the note-local name still resolves normally alongside it.
    expect(
      resolveScopedPath({ store, vault: throwingVault() }, 'x').value,
    ).toBe(1);
  });

  it('a vault entry holding a trap-bomb value degrades on the walk', () => {
    const vault = vaultOf({ x: fresh(trapBombProxy()) });
    expect(resolveScopedPath({ vault }, '@x.stars').status).toBe('missing');
  });

  it('a throwing note-local store never breaks an @-name resolution, and vice versa', () => {
    const scope = {
      store: throwingStore(),
      vault: vaultOf({ x: fresh(42) }),
    };
    expect(resolveScopedPath(scope, '@x').value).toBe(42);
    expect(resolveScopedPath(scope, 'x').status).toBe('missing');
  });
});

/**
 * Every hostile-store shape, rendered end to end. Each case is a document
 * plus the stores it is rendered with; the same table drives `renderMark`
 * and `renderMarkNode` so the two entry points can never diverge on hostile
 * input (they share `hastToReactTree`, and this is what keeps that true).
 */
const HOSTILE_CASES: ReadonlyArray<{
  label: string;
  text: string;
  store?: ValueStore;
  vault?: VaultStore;
}> = [
  {
    label: 'throwing store, :value bare',
    text: ':value[x]',
    store: throwingStore(),
  },
  {
    label: 'throwing store, :value dotted',
    text: ':value[x.y]',
    store: throwingStore(),
  },
  {
    label: 'throwing store, data-bound component',
    text: '::stat{data=x}',
    store: throwingStore(),
  },
  {
    label: 'throwing store, inside a container directive',
    text: ':::card\n:value[x.y]\n:::',
    store: throwingStore(),
  },
  {
    label: 'throwing vault, @-name',
    text: ':value[@x.y]',
    vault: throwingVault(),
  },
  {
    label: 'throwing vault, data-bound component',
    text: '::stat{data=@x}',
    vault: throwingVault(),
  },
  {
    label: 'revoked proxy stored value, dotted path',
    text: ':value[x.stars]',
    store: storeOf({ x: fresh(revokedProxy()) }),
  },
  {
    label: 'trap-bomb stored value, dotted path',
    text: ':value[x.stars]',
    store: storeOf({ x: fresh(trapBombProxy()) }),
  },
  {
    label: 'entry whose value getter throws on the second read',
    text: ':value[x.stars]',
    store: storeOf({ x: secondReadThrows() }),
  },
  {
    label: 'value whose toString/toJSON both throw',
    text: ':value[x]',
    store: storeOf({
      x: fresh({
        toString: () => boom(),
        toJSON: () => boom(),
        [Symbol.toPrimitive]: () => boom(),
      }),
    }),
  },
  {
    label: 'cyclic value (JSON.stringify throws)',
    text: ':value[x]',
    store: storeOf({
      x: fresh(
        (() => {
          const self: Record<string, unknown> = {};
          self.self = self;
          return self;
        })(),
      ),
    }),
  },
  {
    label: 'store whose methods are not functions at all',
    text: ':value[x]',
    store: { get: 5, has: 5, set: 5, snapshot: 5 } as unknown as ValueStore,
  },
  // A BARE (non-dotted) name performs no path walk, so the resolution layer
  // hands the hostile value straight to the component — correctly, since it
  // must not touch it. These are the cases the reference data-bound
  // components guard themselves, via `safeRead` (`./safe-data`).
  {
    label: 'stat bound to a bare revoked-proxy value',
    text: '::stat{data=x}',
    store: storeOf({ x: fresh(revokedProxy()) }),
  },
  {
    label: 'stat bound to a bare trap-bomb value',
    text: '::stat{data=x}',
    store: storeOf({ x: fresh(trapBombProxy()) }),
  },
  {
    label: 'progress bound to a bare trap-bomb value',
    text: '::progress{data=x}',
    store: storeOf({ x: fresh(trapBombProxy()) }),
  },
  {
    label: 'progress bound to a bare revoked-proxy value',
    text: '::progress{data=x}',
    store: storeOf({ x: fresh(revokedProxy()) }),
  },
  {
    label: 'chart bound to a bare revoked-proxy value',
    text: '::chart{data=x}',
    store: storeOf({ x: fresh(revokedProxy()) }),
  },
  {
    label: 'chart bound to an array proxy whose get trap throws',
    text: '::chart{data=x}',
    store: storeOf({
      x: fresh(new Proxy([1, 2, 3], { get: () => boom() })),
    }),
  },
  {
    label: 'chart bound to an array that throws partway through iteration',
    text: '::chart{data=x}',
    store: storeOf({ x: fresh(explodingAtIndex(5)) }),
  },
  {
    label: 'chart bound to an array whose ELEMENT is a trap bomb',
    text: '::chart{data=x}',
    store: storeOf({ x: fresh([1, 2, trapBombProxy()]) }),
  },
  {
    label: 'stat bound to an object with a throwing field getter',
    text: '::stat{data=x}',
    store: storeOf({
      x: fresh({
        get value(): unknown {
          throw new Error('field explodes');
        },
      }),
    }),
  },
];

describe('renderMark — hostile host store never escapes the render phase', () => {
  it.each(HOSTILE_CASES)('$label', ({ text, store, vault }) => {
    expect(() =>
      render(renderMark(text, defaultRegistry, store, vault)),
    ).not.toThrow();
  });

  it('a throwing store renders the ordinary {name} marker, with the message only as a tooltip', () => {
    const { container } = render(
      renderMark(':value[x.stars]', defaultRegistry, throwingStore()),
    );
    const marker = container.querySelector('.mk-value--missing');
    expect(marker).not.toBeNull();
    expect(marker).toHaveTextContent('{x.stars}');
    expect(marker?.getAttribute('title')).toBe('store exploded');
    // No failure kind is invented for a host-store fault.
    expect(marker?.className).toBe('mk-value mk-value--missing');
    // Cleanliness: the message never becomes body text.
    expect(container.textContent).not.toContain('store exploded');
  });

  it('a throwing store leaves a data-bound component in its quiet empty state with a tooltip', () => {
    const { container } = render(
      renderMark('::stat{data=x}', defaultRegistry, throwingStore()),
    );
    const stat = container.querySelector('.mk-stat');
    expect(stat).not.toBeNull();
    expect(stat?.getAttribute('title')).toBe('store exploded');
    expect(stat?.querySelector('.mk-stat__value')).toHaveTextContent('—');
    expect(container.textContent).not.toContain('store exploded');
  });

  it('a hostile bare-name value leaves stat in its quiet — state, message in the tooltip only', () => {
    const store = storeOf({ x: fresh(trapBombProxy()) });
    const { container } = render(
      renderMark('::stat{data=x}', defaultRegistry, store),
    );
    const stat = container.querySelector('.mk-stat');
    expect(stat?.querySelector('.mk-stat__value')).toHaveTextContent('—');
    expect(stat?.getAttribute('title')).toBe('store exploded');
    // A fresh-but-unreadable binding invents no failure kind and no
    // stale/error class — the body is simply the ordinary empty state.
    expect(stat?.className).toBe('mk-stat');
    expect(container.textContent).not.toContain('store exploded');
  });

  it('a hostile bare-name value leaves progress at its quiet 0% bar', () => {
    const store = storeOf({ x: fresh(trapBombProxy()) });
    const { container } = render(
      renderMark('::progress{data=x}', defaultRegistry, store),
    );
    const bar = container.querySelector('.mk-progress');
    expect(bar?.getAttribute('aria-valuenow')).toBe('0');
    expect(bar?.getAttribute('title')).toBe('store exploded');
    expect(container.textContent).not.toContain('store exploded');
  });

  it('a hostile bare-name value leaves chart at its quiet no-data state', () => {
    const store = storeOf({ x: fresh(explodingAtIndex(5)) });
    const { container } = render(
      renderMark('::chart{data=x}', defaultRegistry, store),
    );
    const chart = container.querySelector('.mk-chart--empty');
    expect(chart).not.toBeNull();
    expect(chart).toHaveTextContent('no data');
    expect(chart?.getAttribute('title')).toBe('store exploded');
    // Partial results are never plotted: an unreadable series is all-or-nothing.
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('an unreadable binding still lets chart plot its static values= series', () => {
    // An ARRAY proxy: it passes `Array.isArray`, so the extraction commits
    // to the bound series and then throws mid-iteration — the fallback path
    // is what re-resolves against `values=` instead.
    const store = storeOf({ x: fresh(explodingAtIndex(1)) });
    const { container } = render(
      renderMark('::chart{data=x values="1,3,2"}', defaultRegistry, store),
    );
    const svg = container.querySelector('svg.mk-chart');
    expect(svg).not.toBeNull();
    expect(container.querySelector('.mk-chart--empty')).toBeNull();
    // The fault still explains itself, as an SVG <title>, never body text.
    expect(svg?.querySelector('title')?.textContent).toBe('store exploded');
  });

  it('a real store-level error message still wins over a read fault on the same binding', () => {
    const store = storeOf({
      x: {
        value: trapBombProxy(),
        status: 'error',
        error: 'the script failed',
        failureKind: 'limit',
      },
    });
    const { container } = render(
      renderMark('::stat{data=x}', defaultRegistry, store),
    );
    const stat = container.querySelector('.mk-stat');
    expect(stat?.getAttribute('title')).toBe(
      'limit exceeded: the script failed',
    );
    expect(stat).toHaveClass('mk-stat--limit');
  });

  it('a hostile store never stops the rest of the document from rendering', () => {
    const { container } = render(
      renderMark(
        '# Title\n\n:value[x.stars]\n\nplain paragraph',
        defaultRegistry,
        throwingStore(),
      ),
    );
    expect(container.querySelector('h1')).toHaveTextContent('Title');
    expect(container.textContent).toContain('plain paragraph');
    // Not the whole-document failure box either — degradation is local.
    expect(container.querySelector('.mk-unknown')).toBeNull();
  });
});

describe('renderMarkNode — same hostile-store guarantee as renderMark', () => {
  it.each(HOSTILE_CASES)('$label', ({ text, store, vault }) => {
    expect(() => {
      for (const child of parse(text).children) {
        render(renderMarkNode(child, defaultRegistry, store, vault));
      }
    }).not.toThrow();
  });

  it('produces the same degraded markup renderMark does for a throwing store', () => {
    const text = ':value[x.stars]';
    const store = throwingStore();
    const [first] = parse(text).children;
    expect(first).toBeDefined();
    if (!first) return;
    const whole = render(renderMark(text, defaultRegistry, store));
    const node = render(renderMarkNode(first, defaultRegistry, store));
    expect(node.container.innerHTML).toBe(whole.container.innerHTML);
  });
});
