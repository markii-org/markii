import { describe, expect, it } from 'vitest';
import { renderMarkToHtml } from './render';
import {
  createHtmlRegistry,
  type HtmlComponent,
  type HtmlRegistry,
} from './registry';

const chip: HtmlComponent = (_attrs, children) =>
  `<span class="probe-chip">${children}</span>`;

const registry: HtmlRegistry = createHtmlRegistry({
  chip: { component: chip, inline: true },
  // A block-kind component must never get the empty-inline marker.
  box: { component: chip, inline: false },
  // A registration with no `inline` metadata keeps rendering unchanged.
  quiet: { component: chip },
});

describe('ITEM 1: an inline component that renders empty (HTML engine)', () => {
  it('still renders the component (no fallback box) when written empty as a leaf', () => {
    const html = renderMarkToHtml('::chip{label="x"}', registry);
    expect(html).toContain('probe-chip');
    expect(html).not.toContain('mk-unknown');
  });

  it('wraps the empty component in the quiet marker with an explanatory title', () => {
    const html = renderMarkToHtml('::chip{label="x"}', registry);
    expect(html).toContain('class="mk-inline-empty"');
    expect(html).toMatch(/mk-inline-empty" title="[^"]*chip[^"]*"/);
    expect(html).toContain('<span class="mk-inline-empty"');
  });

  it('written as an inline directive with empty brackets also gets the marker', () => {
    const html = renderMarkToHtml(':chip[]', registry);
    expect(html).toContain('mk-inline-empty');
  });

  it('does NOT mark a chip that has content', () => {
    const html = renderMarkToHtml(':chip[hello]', registry);
    expect(html).not.toContain('mk-inline-empty');
    expect(html).toContain('hello');
  });

  it('does NOT mark an empty component registered inline: false', () => {
    const html = renderMarkToHtml('::box{}', registry);
    expect(html).not.toContain('mk-inline-empty');
    expect(html).toContain('probe-chip');
  });

  it('does NOT mark an empty component with no inline metadata at all', () => {
    const html = renderMarkToHtml('::quiet{}', registry);
    expect(html).not.toContain('mk-inline-empty');
    expect(html).toContain('probe-chip');
  });
});
