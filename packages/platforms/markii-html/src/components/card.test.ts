import { describe, expect, it } from 'vitest';
import { renderMarkToHtml } from '../render.js';
import { createTestContext } from '../test/html-context.js';
import { Card } from './card.js';
import { defaultHtmlRegistry } from './index.js';

const ctx = createTestContext();

describe('Card', () => {
  it('renders title and body when a title is given', () => {
    const html = Card({ title: 'Notes' }, 'some body', ctx);
    expect(html).toContain('<div class="mk-card__title">Notes</div>');
    expect(html).toContain('<div class="mk-card__body">some body</div>');
  });

  it('omits the title element entirely when no title is given', () => {
    const html = Card({}, 'some body', ctx);
    expect(html).not.toContain('mk-card__title');
  });

  it('escapes the title', () => {
    const html = Card({ title: '<b>x</b>' }, 'body', ctx);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('renders the body as rich markdown via the full pipeline', () => {
    const html = renderMarkToHtml(
      ':::card\n- one\n- two\n:::',
      defaultHtmlRegistry,
    );
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });
});
