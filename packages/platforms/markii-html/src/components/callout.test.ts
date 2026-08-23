import { describe, expect, it } from 'vitest';
import { renderMarkToHtml } from '../render.js';
import { createTestContext } from '../test/html-context.js';
import { Callout } from './callout.js';
import { defaultHtmlRegistry } from './index.js';

const ctx = createTestContext();

describe('Callout', () => {
  it('defaults to info when no type is given, with no title element', () => {
    const html = Callout({}, 'body', ctx);
    expect(html).toContain('mk-callout mk-callout--info');
    expect(html).not.toContain('mk-callout__title');
    expect(html).toContain('<div class="mk-callout__body">body</div>');
  });

  it('applies the requested type and renders a title when given', () => {
    const html = Callout({ type: 'danger', title: 'Careful' }, 'body', ctx);
    expect(html).toContain('mk-callout mk-callout--danger');
    expect(html).toContain('<span class="mk-callout__title">Careful</span>');
  });

  it('falls back to info for an invalid/unknown type rather than throwing', () => {
    expect(() => Callout({ type: 'nonsense' }, 'body', ctx)).not.toThrow();
    expect(Callout({ type: 'nonsense' }, 'body', ctx)).toContain(
      'mk-callout--info',
    );
  });

  it('escapes the title', () => {
    const html = Callout({ title: '<script>' }, 'body', ctx);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders via the full pipeline with role="note"', () => {
    const html = renderMarkToHtml(
      ':::callout{type=warning title="Heads up"}\nMind the gap.\n:::',
      defaultHtmlRegistry,
    );
    expect(html).toContain('mk-callout--warning');
    expect(html).toContain('role="note"');
    expect(html).toContain('<p>Mind the gap.</p>');
  });
});
