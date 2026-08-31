import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import type { StoredValue } from '@markii/runtime';
import { createRegistry } from '@markii/react';
import {
  renderNoteBodyForExport,
  renderNoteBodyToHtml,
} from './render-body.js';

const NOTE = '# Hello\n\nTotal: :value[total]\n';

describe('renderNoteBodyToHtml', () => {
  it('renders a plain note through the standard registry', () => {
    const html = renderNoteBodyToHtml(NOTE, {});
    expect(html).toContain('<h1>Hello</h1>');
    expect(html).toContain('mk-value--missing');
  });

  it('bakes a stored value into the body', () => {
    const values: Record<string, StoredValue> = {
      total: { value: 42, status: 'fresh' },
    };
    const html = renderNoteBodyToHtml(NOTE, values);
    expect(html).toContain('42');
  });

  it('renders through a custom registry when one is given', () => {
    const registry = createRegistry({
      shout: {
        component: ({ attributes }) =>
          createElement(
            'strong',
            { className: 'mk-shout' },
            attributes.text ?? '',
          ),
        inline: false,
      },
    });
    const html = renderNoteBodyToHtml(':::shout{text=hi}\n:::\n', {}, registry);
    expect(html).toContain('mk-shout');
    expect(html).toContain('hi');
  });
});

describe('renderNoteBodyForExport', () => {
  it('reports ok with the rendered markup on success', async () => {
    const renderBody = renderNoteBodyForExport();
    const result = await renderBody(NOTE, {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.html).toContain('<h1>Hello</h1>');
  });

  it('reports render-failed rather than throwing when a component throws', async () => {
    const registry = createRegistry({
      boom: {
        component: () => {
          throw new Error('component exploded');
        },
      },
    });
    const renderBody = renderNoteBodyForExport(registry);
    const result = await renderBody(':::boom\n:::\n', {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('render-failed');
    expect(result.detail).toContain('component exploded');
  });
});
