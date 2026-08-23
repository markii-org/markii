import { describe, expect, it } from 'vitest';
import { renderMarkToHtml } from '../render.js';
import { defaultHtmlRegistry } from './index.js';

describe('Badge', () => {
  it('defaults to the neutral variant when no variant attribute is given', () => {
    const html = renderMarkToHtml(':badge[New]', defaultHtmlRegistry);
    expect(html).toContain(
      '<span class="mk-badge mk-badge--neutral">New</span>',
    );
  });

  it('applies the requested variant class', () => {
    const html = renderMarkToHtml(
      ':badge[Shipped]{variant=success}',
      defaultHtmlRegistry,
    );
    expect(html).toContain('mk-badge--success');
  });

  it('falls back to neutral for an invalid/unknown variant rather than throwing', () => {
    expect(() =>
      renderMarkToHtml(':badge[Odd]{variant=nonsense}', defaultHtmlRegistry),
    ).not.toThrow();
    const html = renderMarkToHtml(
      ':badge[Odd]{variant=nonsense}',
      defaultHtmlRegistry,
    );
    expect(html).toContain('mk-badge--neutral');
  });

  it('renders inline (a <span>, sitting inside surrounding text)', () => {
    const html = renderMarkToHtml(
      'Status: :badge[Beta]{variant=info} today.',
      defaultHtmlRegistry,
    );
    expect(html).toContain(
      '<p>Status: <span class="mk-badge mk-badge--info">Beta</span> today.</p>',
    );
  });
});
