import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createValueStore, createVaultStore } from '@markii/runtime';
import type { StoredValue, ValueStatus } from '@markii/runtime';
import { renderMark } from './render.js';
import { createRegistry } from './registry.js';
import type { MarkComponentProps } from './registry.js';
import { resolveScopedPath } from './store-path.js';

/** Built through a function so tsc does not widen `status` for keys like `constructor`. */
function entry(value: unknown, status: ValueStatus = 'fresh'): StoredValue {
  return { value, status };
}

function Probe({ attributes, data, dataStatus }: MarkComponentProps) {
  return (
    <div
      data-status={dataStatus ?? 'none'}
      data-value={JSON.stringify(data ?? null)}
      data-attrs={JSON.stringify(attributes)}
    />
  );
}

const registry = createRegistry({ probe: { component: Probe } });

function renderDoc(
  md: string,
  store?: ReturnType<typeof createValueStore>,
  vault?: ReturnType<typeof createVaultStore>['store'],
) {
  return render(renderMark(md, registry, store, vault));
}

describe('adversarial:hostile @-names never throw and never resolve', () => {
  const vault = createVaultStore({
    initial: { gh: entry({ stars: 5 }) },
  }).store;

  it.each([
    '@__proto__',
    '@constructor',
    '@toString',
    '@hasOwnProperty',
    '@',
    '@@gh',
    '@gh..stars',
    '@gh.constructor',
    '@gh.__proto__',
    '@gh.hasOwnProperty',
    '@.gh',
  ])('data=%s degrades to missing', (name) => {
    const { container } = renderDoc(`::probe{data=${name}}`, undefined, vault);
    const el = container.querySelector('[data-status]');
    expect(el?.getAttribute('data-status')).toBe('missing');
    expect(el?.getAttribute('data-value')).toBe('null');
  });

  it('resolveScopedPath agrees at the raw-string level (pre-markdown)', () => {
    for (const name of [
      '@__proto__',
      '@constructor',
      '@',
      '@@gh',
      '@gh..stars',
      '@gh.constructor',
    ]) {
      expect(resolveScopedPath({ vault }, name).status).toBe('missing');
      expect(resolveScopedPath({ vault }, name).value).toBeUndefined();
    }
  });

  it.each(['__proto__', 'constructor', 'toString'])(
    'a genuine vault entry named %s resolves correctly once actually published',
    (hostileName) => {
      // NB: seeded through the writer (the real publish path). An object
      // literal `{ __proto__: x }` would NOT work here — that is the special
      // prototype-setter syntax, so it creates no own key for `Object.entries`
      // to copy. A computed key is used for `initial` to prove both routes.
      const viaWriter = createVaultStore();
      viaWriter.writer.publish(hostileName, entry({ stars: 1 }));
      expect(
        resolveScopedPath({ vault: viaWriter.store }, `@${hostileName}`),
      ).toMatchObject({ value: { stars: 1 }, status: 'fresh' });

      const viaInitial = createVaultStore({
        initial: { [hostileName]: entry({ stars: 2 }) },
      }).store;
      expect(
        resolveScopedPath({ vault: viaInitial }, `@${hostileName}`),
      ).toMatchObject({ value: { stars: 2 }, status: 'fresh' });
    },
  );
});

describe('adversarial:scope isolation', () => {
  it('a note-local name never satisfies an @name, and vice versa', () => {
    const store = createValueStore({ gh: entry({ stars: 99 }) });
    const vault = createVaultStore({
      initial: { gh: entry({ stars: 5 }) },
    }).store;

    // @gh with NO vault must not fall back to the note store.
    expect(resolveScopedPath({ store }, '@gh').status).toBe('missing');
    // bare gh must not read the vault.
    expect(resolveScopedPath({ vault }, 'gh').status).toBe('missing');
    // Both present: each reads its own scope.
    expect(resolveScopedPath({ store, vault }, '@gh.stars').value).toBe(5);
    expect(resolveScopedPath({ store, vault }, 'gh.stars').value).toBe(99);
  });

  it('end-to-end: data=@gh.stars reads the vault, data=gh.stars reads the note', () => {
    const store = createValueStore({ gh: entry({ stars: 99 }) });
    const vault = createVaultStore({
      initial: { gh: entry({ stars: 5 }) },
    }).store;
    const { container } = renderDoc(
      '::probe{data=@gh.stars}\n\n::probe{data=gh.stars}',
      store,
      vault,
    );
    const els = container.querySelectorAll('[data-value]');
    expect(els[0]?.getAttribute('data-value')).toBe('5');
    expect(els[1]?.getAttribute('data-value')).toBe('99');
  });
});

describe('adversarial:render purity', () => {
  it('rendering with a vault performs reads only', () => {
    const handle = createVaultStore({ initial: { gh: entry({ stars: 5 }) } });
    const before = JSON.stringify(handle.store.snapshot());
    renderDoc(
      '::probe{data=@gh.stars}\n\nText :value[@gh.stars] and :value[@nope].\n\n::unknownthing{data=@gh}',
      undefined,
      handle.store,
    );
    expect(JSON.stringify(handle.store.snapshot())).toBe(before);
  });
});

describe('adversarial:regressions', () => {
  it('the 3-arg renderMark signature still resolves bare names', () => {
    const store = createValueStore({ gh: entry({ stars: 42 }) });
    const { container } = render(
      renderMark('::probe{data=gh.stars}', registry, store),
    );
    expect(
      container.querySelector('[data-value]')?.getAttribute('data-value'),
    ).toBe('42');
  });

  it('an unknown directive with an @name still renders the fallback, never throws', () => {
    const { container } = renderDoc(
      '::nosuch{data=@gh.stars}',
      undefined,
      undefined,
    );
    expect(container.querySelector('.mk-unknown')).not.toBeNull();
  });

  it('inline directives strip reserved layout keys and never get a wrapper', () => {
    const { container } = renderDoc(
      'Text :probe[x]{width=narrow align=center} end.',
    );
    const el = container.querySelector('[data-attrs]');
    const attrs = JSON.parse(el?.getAttribute('data-attrs') ?? '{}') as Record<
      string,
      unknown
    >;
    expect(Object.hasOwn(attrs, 'width')).toBe(false);
    expect(Object.hasOwn(attrs, 'align')).toBe(false);
    expect(container.querySelector('.mk-width-narrow')).toBeNull();
    expect(container.querySelector('.mk-align-center')).toBeNull();
  });

  it('block directives still get their layout wrapper', () => {
    const { container } = renderDoc('::probe{width=narrow align=center}');
    expect(
      container.querySelector('.mk-width-narrow.mk-align-center'),
    ).not.toBeNull();
  });

  it(':value[@name] renders the missing marker with the name as written', () => {
    const { container } = renderDoc('Value :value[@gh.stars] here.');
    const marker = container.querySelector('.mk-value--missing');
    expect(marker?.textContent).toBe('{@gh.stars}');
  });

  it(':value[@name] renders a vault value and marks a stale one', () => {
    const vault = createVaultStore({
      initial: { gh: entry(5), old: entry(3, 'stale') },
    }).store;
    const { container } = renderDoc(
      ':value[@gh] and :value[@old]',
      undefined,
      vault,
    );
    expect(container.querySelector('.mk-value')?.textContent).toBe('5');
    expect(container.querySelector('.mk-value--stale')?.textContent).toBe('3');
  });
});
