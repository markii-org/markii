import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createValueStore } from '@markii/runtime';
import type { FailureKind, StoredValue, ValueStore } from '@markii/runtime';
import { renderMark } from '../render';
import { defaultRegistry } from './index';
import {
  dataStateClassName,
  failureKindClass,
  failurePhrase,
  failureTitle,
} from './failure-presentation';

/** A store holding one entry named `x`, so every case below can bind with `data=x`. */
function storeWith(entry: StoredValue): ValueStore {
  return createValueStore({ x: entry });
}

/** `class` read via `getAttribute`, which works identically for HTML and SVG roots (`svg.className` is an `SVGAnimatedString`, not a string). */
function classOf(element: Element | null): string {
  return element?.getAttribute('class') ?? '';
}

/** The tooltip, wherever the component puts it: a `title` attribute (HTML) or an SVG `<title>` child. */
function tooltipOf(element: Element | null): string | undefined {
  return (
    element?.getAttribute('title') ??
    element?.querySelector('title')?.textContent ??
    undefined
  );
}

/** Every data-bound directive under test, with the root element each renders and its base class. */
const DATA_BOUND = [
  { name: 'stat', source: '::stat{data=x label="stars"}', root: '.mk-stat' },
  { name: 'progress', source: '::progress{data=x}', root: '.mk-progress' },
  { name: 'chart', source: '::chart{data=x}', root: '.mk-chart' },
] as const;

describe('failure-presentation helpers', () => {
  it('words every FailureKind in the taxonomy, including tier-blocked', () => {
    const kinds: FailureKind[] = [
      'script-error',
      'capability-denied',
      'tier-blocked',
      'limit',
    ];
    for (const kind of kinds) {
      expect(failurePhrase(kind)).toBeTruthy();
    }
    expect(failurePhrase('tier-blocked')).toBe('requires manual run');
  });

  it('leads the tooltip with the phrase and keeps the underlying message', () => {
    expect(failureTitle('boom', 'script-error')).toBe('script error: boom');
    expect(failureTitle(undefined, 'tier-blocked')).toBe('requires manual run');
    expect(failureTitle('boom', undefined)).toBe('boom');
    expect(failureTitle(undefined, undefined)).toBeUndefined();
    expect(failureTitle('', undefined)).toBeUndefined();
  });

  it('never resolves an out-of-taxonomy or prototype-chain kind', () => {
    // A `StoredValue` is typed, but nothing stops a host app or a
    // hand-written fixture from putting an arbitrary string there — the cast
    // is the point of this test, not a shortcut around the type.
    const hostile = [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      '"><script>alert(1)</script>',
      'tier-blocked ',
      'TIER-BLOCKED',
    ] as unknown as FailureKind[];
    for (const kind of hostile) {
      expect(failurePhrase(kind)).toBeUndefined();
      expect(failureKindClass('mk-stat', kind)).toBeUndefined();
      expect(failureTitle(undefined, kind)).toBeUndefined();
      expect(dataStateClassName('mk-stat', 'error', kind)).toBe('mk-stat');
    }
  });

  it('builds base/extra/status/kind classes in a stable order', () => {
    expect(
      dataStateClassName('mk-chart', 'error', 'limit', ['mk-chart--empty']),
    ).toBe('mk-chart mk-chart--empty mk-chart--limit');
    expect(dataStateClassName('mk-stat', 'stale', undefined)).toBe(
      'mk-stat mk-stat--stale',
    );
    expect(dataStateClassName('mk-stat', 'fresh', undefined)).toBe('mk-stat');
    expect(dataStateClassName('mk-stat', undefined, undefined)).toBe('mk-stat');
  });
});

describe('data-bound components mirror ValueDirective failure presentation', () => {
  for (const { name, source, root } of DATA_BOUND) {
    it(`${name}: a tier-blocked error surfaces as tooltip + class, never body text`, () => {
      const store = storeWith({
        value: undefined,
        status: 'error',
        error: 'auto tier may not run this script',
        failureKind: 'tier-blocked',
      });
      const { container } = render(renderMark(source, defaultRegistry, store));
      const element = container.querySelector(root);
      expect(element).not.toBeNull();
      expect(classOf(element)).toContain(`mk-${name}--tier-blocked`);
      expect(tooltipOf(element)).toBe(
        'requires manual run: auto tier may not run this script',
      );
      // The worded hint exists ONLY in the tooltip — never in body text.
      expect(container.textContent).not.toContain('requires manual run');
      expect(container.textContent).not.toContain('auto tier may not run');
    });

    it(`${name}: a stale binding gets the stale class and no failure class`, () => {
      const store = storeWith({ value: 3, status: 'stale', ranAt: 1 });
      const { container } = render(renderMark(source, defaultRegistry, store));
      const element = container.querySelector(root);
      expect(classOf(element)).toContain(`mk-${name}--stale`);
      expect(classOf(element)).not.toContain('--tier-blocked');
      expect(tooltipOf(element)).toBeUndefined();
    });

    it(`${name}: a missing binding presents no failure kind and no tooltip`, () => {
      const { container } = render(renderMark(source, defaultRegistry));
      const element = container.querySelector(root);
      expect(element).not.toBeNull();
      expect(classOf(element).split(' ')).not.toContain(
        `mk-${name}--tier-blocked`,
      );
      expect(classOf(element)).not.toContain('--stale');
      expect(tooltipOf(element)).toBeUndefined();
    });

    it(`${name}: a partially-resolved dotted path never invents a failure kind`, () => {
      // The ROOT entry carries a failure kind, but `data=x.nope` resolves to
      // `missing`, not `error` — the same gate ValueDirective applies.
      const store = storeWith({
        value: { real: 1 },
        status: 'error',
        error: 'boom',
        failureKind: 'script-error',
      });
      const { container } = render(
        renderMark(
          source.replace('data=x', 'data=x.nope'),
          defaultRegistry,
          store,
        ),
      );
      const element = container.querySelector(root);
      expect(classOf(element)).not.toContain('--script-error');
    });

    it(`${name}: a data payload cannot spoof a failure kind`, () => {
      // `failureKind` is store metadata; a stored *value* that happens to
      // carry a field by that name must never reach presentation.
      const store = storeWith({
        value: {
          value: 7,
          failureKind: 'tier-blocked',
          error: 'pretend',
          status: 'error',
        },
        status: 'fresh',
        ranAt: 1,
      });
      const { container } = render(renderMark(source, defaultRegistry, store));
      const element = container.querySelector(root);
      expect(classOf(element)).not.toContain('--tier-blocked');
      expect(tooltipOf(element)).toBeUndefined();
      expect(container.textContent).not.toContain('requires manual run');
    });

    it(`${name}: an error with no failureKind shows only the raw message as a tooltip`, () => {
      const store = storeWith({
        value: undefined,
        status: 'error',
        error: 'boom',
      });
      const { container } = render(renderMark(source, defaultRegistry, store));
      const element = container.querySelector(root);
      expect(tooltipOf(element)).toBe('boom');
      expect(container.textContent).not.toContain('boom');
    });
  }

  it('chart keeps plotting its static fallback series while marking the failure', () => {
    const store = storeWith({
      value: undefined,
      status: 'error',
      error: 'boom',
      failureKind: 'capability-denied',
    });
    const { container } = render(
      renderMark('::chart{data=x values="1,3,2"}', defaultRegistry, store),
    );
    const svg = container.querySelector('svg.mk-chart');
    expect(svg).not.toBeNull();
    expect(classOf(svg)).toContain('mk-chart--capability-denied');
    expect(tooltipOf(svg)).toBe('needs permission: boom');
    expect(svg?.getAttribute('aria-label')).toBe('line chart, 3 points');
  });

  it('a directive with no data= attribute is untouched by failure presentation', () => {
    const { container } = render(
      renderMark('::stat{value=42}', defaultRegistry),
    );
    const stat = container.querySelector('.mk-stat');
    expect(classOf(stat)).toBe('mk-stat');
    expect(tooltipOf(stat)).toBeUndefined();
  });

  it('ValueDirective still presents the same phrase for the same store entry', () => {
    const store = storeWith({
      value: undefined,
      status: 'error',
      error: 'auto tier may not run this script',
      failureKind: 'tier-blocked',
    });
    const { container } = render(
      renderMark(':value[x]', defaultRegistry, store),
    );
    const marker = container.querySelector('.mk-value--missing');
    expect(classOf(marker)).toContain('mk-value--tier-blocked');
    expect(tooltipOf(marker)).toBe(
      'requires manual run: auto tier may not run this script',
    );
    expect(marker?.textContent).toBe('{x}');
  });
});
