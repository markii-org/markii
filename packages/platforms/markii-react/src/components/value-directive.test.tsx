import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createValueStore, createVaultStore } from '@markii/runtime';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

describe('ValueDirective — @-prefixed vault reads (docs/scripting.md)', () => {
  it(':value[@gh.stars] renders the value end-to-end through renderMark with a vault', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: { stars: 42 }, status: 'fresh' } },
    });
    const { container } = render(
      renderMark(':value[@gh.stars]', defaultRegistry, undefined, vault),
    );
    const value = container.querySelector('.mk-value');
    expect(value).not.toBeNull();
    expect(value).toHaveTextContent('42');
    expect(container.querySelector('.mk-value--missing')).toBeNull();
  });

  it(':value[@gh.stars] renders the missing marker containing the literal name when no vault is supplied', () => {
    const { container } = render(
      renderMark(':value[@gh.stars]', defaultRegistry),
    );
    const missing = container.querySelector('.mk-value--missing');
    expect(missing).not.toBeNull();
    expect(missing).toHaveTextContent('{@gh.stars}');
  });

  it('a bare note-local store never satisfies an @-prefixed name', () => {
    const store = createValueStore({
      gh: { value: { stars: 99 }, status: 'fresh' },
    });
    const { container } = render(
      renderMark(':value[@gh.stars]', defaultRegistry, store),
    );
    const missing = container.querySelector('.mk-value--missing');
    expect(missing).not.toBeNull();
    expect(missing).toHaveTextContent('{@gh.stars}');
  });

  it(':value[@] renders the missing marker without throwing', () => {
    expect(() =>
      render(renderMark(':value[@]', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(renderMark(':value[@]', defaultRegistry));
    expect(container.querySelector('.mk-value--missing')).not.toBeNull();
  });

  it(':value[@__proto__] renders the missing marker without throwing, even against a populated vault', () => {
    // Note: `__proto__` inside a directive label is itself parsed as
    // markdown emphasis (`__x__` -> `<strong>`) upstream in `@markii/core`,
    // so the label CommonMark sees here is not literally the six-underscore
    // name — this test only asserts the graceful degrade-to-missing
    // contract, not the exact displayed text (that exact-text case is
    // covered directly against `resolveScopedPath` in `../store-path.test`).
    const { store: vault } = createVaultStore({
      initial: { gh: { value: 1, status: 'fresh' } },
    });
    expect(() =>
      render(
        renderMark(':value[@__proto__]', defaultRegistry, undefined, vault),
      ),
    ).not.toThrow();
    const { container } = render(
      renderMark(':value[@__proto__]', defaultRegistry, undefined, vault),
    );
    expect(container.querySelector('.mk-value--missing')).not.toBeNull();
  });

  it('a vault-stale value gets the mk-value--stale class', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: 41, status: 'stale' } },
    });
    const { container } = render(
      renderMark(':value[@gh]', defaultRegistry, undefined, vault),
    );
    const stale = container.querySelector('.mk-value--stale');
    expect(stale).not.toBeNull();
    expect(stale).toHaveTextContent('41');
  });

  it('a vault error value renders the missing marker without throwing', () => {
    const { store: vault } = createVaultStore({
      initial: { gh: { value: null, status: 'error', error: 'fetch failed' } },
    });
    expect(() =>
      render(renderMark(':value[@gh]', defaultRegistry, undefined, vault)),
    ).not.toThrow();
    const { container } = render(
      renderMark(':value[@gh]', defaultRegistry, undefined, vault),
    );
    expect(container.querySelector('.mk-value--missing')).not.toBeNull();
  });
});

describe('ValueDirective — failure-kind-derived presentation (docs/scripting.md)', () => {
  it.each([
    ['script-error', 'script error'],
    ['capability-denied', 'needs permission'],
    ['tier-blocked', 'requires manual run'],
    ['limit', 'limit exceeded'],
  ] as const)(
    'an error entry with failureKind %s gets the mk-value--%s class and a title starting with "%s"',
    (failureKind, phrase) => {
      const store = createValueStore({
        gh: {
          value: null,
          status: 'error',
          error: 'underlying message',
          failureKind,
        },
      });
      const { container } = render(
        renderMark(':value[gh]', defaultRegistry, store),
      );
      const el = container.querySelector(`.mk-value--${failureKind}`);
      expect(el).not.toBeNull();
      expect(el).toHaveClass('mk-value', 'mk-value--missing');
      expect(el?.getAttribute('title')).toBe(`${phrase}: underlying message`);
      // The bracketed name display is unchanged by failureKind.
      expect(el).toHaveTextContent('{gh}');
    },
  );

  it('an error entry with a failureKind but no message: title is just the phrase', () => {
    const store = createValueStore({
      gh: { value: null, status: 'error', failureKind: 'limit' },
    });
    const { container } = render(
      renderMark(':value[gh]', defaultRegistry, store),
    );
    const el = container.querySelector('.mk-value--limit');
    expect(el?.getAttribute('title')).toBe('limit exceeded');
  });

  it('an error entry with NO failureKind at all degrades to exactly the pre-existing behavior (no kind-modifier class, title is the raw message)', () => {
    const store = createValueStore({
      gh: { value: null, status: 'error', error: 'boom, no kind here' },
    });
    const { container } = render(
      renderMark(':value[gh]', defaultRegistry, store),
    );
    const el = container.querySelector('.mk-value--missing');
    expect(el).not.toBeNull();
    expect(el?.className).toBe('mk-value mk-value--missing');
    expect(el?.getAttribute('title')).toBe('boom, no kind here');
  });

  it('a plain missing name (no run ever happened) never gets a kind-modifier class or a title', () => {
    const store = createValueStore();
    const { container } = render(
      renderMark(':value[nope]', defaultRegistry, store),
    );
    const el = container.querySelector('.mk-value--missing');
    expect(el).not.toBeNull();
    expect(el?.className).toBe('mk-value mk-value--missing');
    expect(el?.hasAttribute('title')).toBe(false);
  });

  it('a partial dotted-path miss on an error root never invents kind-specific presentation (status is missing, not error)', () => {
    const store = createValueStore({
      repo: {
        value: { stars: 1 },
        status: 'error',
        error: 'boom',
        failureKind: 'tier-blocked',
      },
    });
    const { container } = render(
      renderMark(':value[repo.nope]', defaultRegistry, store),
    );
    const el = container.querySelector('.mk-value--missing');
    expect(el).not.toBeNull();
    // The root's failureKind is carried through on the resolution object
    // (see store-path.test.ts), but ValueDirective only ever derives
    // kind-specific presentation from a genuine `status === 'error'`
    // resolution — a partial-path `'missing'` never gets a modifier class.
    expect(container.querySelector('.mk-value--tier-blocked')).toBeNull();
  });

  it('never throws for any failureKind, including a value the taxonomy does not recognize (defensive, cast through unknown)', () => {
    const store = createValueStore({
      gh: {
        value: null,
        status: 'error',
        error: 'x',
        failureKind: 'not-a-real-kind' as never,
      },
    });
    expect(() =>
      render(renderMark(':value[gh]', defaultRegistry, store)),
    ).not.toThrow();
  });
});

describe('ValueDirective — stringifying a hostile stored value', () => {
  /**
   * A stored value is whatever the host wrote into the store. `:value[name]`
   * renders it, so its coercion to text is a host-controlled operation:
   * `JSON.stringify` and `String()` can BOTH throw on the same value. The
   * contract is that display degrades to empty, never to a thrown render.
   */
  function renderValue(value: unknown): HTMLElement {
    const store = createValueStore({ gh: { value, status: 'fresh' } });
    const { container } = render(
      renderMark(':value[gh]', defaultRegistry, store),
    );
    const el = container.querySelector('.mk-value');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  }

  it('a value whose toJSON, toString and Symbol.toPrimitive all throw renders empty', () => {
    const explode = (): never => {
      throw new Error('nope');
    };
    const el = renderValue({
      toJSON: explode,
      toString: explode,
      [Symbol.toPrimitive]: explode,
    });
    expect(el.textContent).toBe('');
  });

  it('a cyclic value (JSON.stringify throws) falls back to String() rather than throwing', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(renderValue(cyclic).textContent).toBe('[object Object]');
  });

  it('a revoked proxy renders empty instead of throwing', () => {
    const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
    revoke();
    expect(renderValue(proxy).textContent).toBe('');
  });

  it('a BigInt (JSON.stringify throws by spec) falls back to String()', () => {
    expect(renderValue(BigInt(42)).textContent).toBe('42');
  });

  it('a value JSON.stringify drops entirely (a function) renders empty, as it always has', () => {
    expect(renderValue(() => 1).textContent).toBe('');
  });
});

describe(':value[...]{format=...} (docs/format.md)', () => {
  it('formats a resolved value with format=compact', () => {
    const store = createValueStore({
      stars: { value: 2301234, status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark(':value[stars]{format=compact}', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-value')).toHaveTextContent('2.3M');
  });

  it('formats with decimals applied', () => {
    const store = createValueStore({
      ratio: { value: 0.12345, status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark(
        ':value[ratio]{format=percent decimals=1}',
        defaultRegistry,
        store,
      ),
    );
    expect(container.querySelector('.mk-value')).toHaveTextContent('12.3%');
  });

  it('an absent format keeps the default plain rendering', () => {
    const store = createValueStore({
      stars: { value: 2301234, status: 'fresh', ranAt: 1 },
    });
    const { container } = render(
      renderMark(':value[stars]', defaultRegistry, store),
    );
    expect(container.querySelector('.mk-value')).toHaveTextContent('2301234');
  });

  it('a missing value still renders the missing marker with format present', () => {
    const { container } = render(
      renderMark(':value[nope]{format=number}', defaultRegistry),
    );
    expect(container.querySelector('.mk-value--missing')).not.toBeNull();
  });
});
