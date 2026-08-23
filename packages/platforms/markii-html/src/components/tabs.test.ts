import { describe, expect, it } from 'vitest';
import { renderMarkToHtml } from '../render.js';
import { escapeHtml } from '../escape.js';
import { Tabs } from './tabs.js';
import { defaultHtmlRegistry } from './index.js';

const ctx = { esc: escapeHtml };

describe('Tabs', () => {
  it('wraps its already-rendered children in mk-tabs', () => {
    expect(Tabs({}, '<div class="mk-tab" role="tabpanel">a</div>', ctx)).toBe(
      '<div class="mk-tabs"><div class="mk-tab" role="tabpanel">a</div></div>',
    );
  });

  it('renders nothing for an empty body', () => {
    expect(Tabs({}, '', ctx)).toBe('');
    expect(Tabs({}, '   ', ctx)).toBe('');
  });

  it(
    'renders every tab panel (no JS switcher, no tablist button bar: ' +
      "this string-based engine has no way to recover a tab child directive's " +
      'label — see tabs.ts)',
    () => {
      const html = renderMarkToHtml(
        [
          '::::tabs',
          ':::tab{label="A"}',
          'first panel',
          ':::',
          ':::tab{label="B"}',
          'second panel',
          ':::',
          '::::',
        ].join('\n'),
        defaultHtmlRegistry,
      );
      expect(html).toContain('mk-tabs');
      expect(html).toContain('first panel');
      expect(html).toContain('second panel');
      expect((html.match(/mk-tab" role="tabpanel"/g) ?? []).length).toBe(2);
      expect(html).not.toContain('role="tablist"');
      expect(html).not.toContain('mk-tabs__button');
    },
  );
});
