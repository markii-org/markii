import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createValueStore, createVaultStore } from '@markii/runtime';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

describe('ValueDirective — @-prefixed vault reads (DESIGN.md §8)', () => {
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
