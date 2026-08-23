import { describe, expect, it } from 'vitest';
import { renderMarkToHtml } from '../render.js';
import { createTestContext } from '../test/html-context.js';
import { Kbd } from './kbd.js';
import { defaultHtmlRegistry } from './index.js';

const ctx = createTestContext();

describe('Kbd', () => {
  it('renders a styled keycap', () => {
    expect(Kbd({}, 'Ctrl+S', ctx)).toBe('<kbd class="mk-kbd">Ctrl+S</kbd>');
  });

  it('renders inline inside surrounding text via the full pipeline', () => {
    const html = renderMarkToHtml(
      'Press :kbd[Ctrl+S] to save.',
      defaultHtmlRegistry,
    );
    expect(html).toContain(
      '<p>Press <kbd class="mk-kbd">Ctrl+S</kbd> to save.</p>',
    );
  });
});
