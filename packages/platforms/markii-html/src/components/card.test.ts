import { describe, expect, it } from 'vitest';
import { TEXT_ALIGN_PRESETS } from '@markii/stdlib';
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

describe('Card — text', () => {
  it.each(TEXT_ALIGN_PRESETS)(
    'text=%s appends the matching mk-text-* class to the panel, covering title and body alike',
    (text) => {
      const html = Card({ title: 'T', text }, '<p>b</p>', ctx);
      expect(html).toContain(`<div class="mk-card mk-text-${text}">`);
      expect(html).toContain('<div class="mk-card__title">T</div>');
    },
  );

  it('ignores an invalid text value', () => {
    expect(Card({ text: 'diagonal' }, 'x', ctx)).toContain(
      '<div class="mk-card">',
    );
  });
});
