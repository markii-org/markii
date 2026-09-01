import { describe, expect, it } from 'vitest';
import { renderMarkToHtml } from '../render.js';
import { createTestContext } from '../test/html-context.js';
import { defaultHtmlRegistry } from './index.js';
import {
  createLayoutWrapper,
  LAYOUT_WRAPPER_PRESETS,
} from './layout-wrapper.js';

const ctx = createTestContext();

describe('createLayoutWrapper', () => {
  it.each(LAYOUT_WRAPPER_PRESETS)(
    'wraps children in mk-layout for %s',
    (preset) => {
      const wrapper = createLayoutWrapper(preset);
      expect(wrapper({}, 'hi', ctx)).toContain('mk-layout');
      expect(wrapper({}, 'hi', ctx)).toContain('hi');
    },
  );

  it('center/left/right add the matching mk-align-* class', () => {
    expect(createLayoutWrapper('center')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-align-center">x</div>',
    );
    expect(createLayoutWrapper('left')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-align-left">x</div>',
    );
    expect(createLayoutWrapper('right')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-align-right">x</div>',
    );
  });

  it('wide/narrow/full add the matching mk-width-* class', () => {
    expect(createLayoutWrapper('wide')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-width-wide">x</div>',
    );
    expect(createLayoutWrapper('narrow')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-width-narrow">x</div>',
    );
    expect(createLayoutWrapper('full')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-width-full">x</div>',
    );
  });

  it('fit adds the matching mk-width-fit class', () => {
    expect(createLayoutWrapper('fit')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-width-fit">x</div>',
    );
  });

  it('ignores attributes entirely: the reserved keys are stripped before a component sees them', () => {
    expect(
      createLayoutWrapper('center')({ foo: 'bar', width: 'fit' }, 'x', ctx),
    ).toBe('<div class="mk-layout mk-align-center">x</div>');
  });

  it('appends ctx.layoutClassName to its own classes on the SAME div', () => {
    const withLayout = createTestContext({ layoutClassName: 'mk-width-fit' });
    expect(createLayoutWrapper('center')({}, 'x', withLayout)).toBe(
      '<div class="mk-layout mk-align-center mk-width-fit">x</div>',
    );
  });
});

describe('renderMarkToHtml — layout wrappers take the other axis as an attribute', () => {
  it('an alignment wrapper takes width, emitting ONE div with both classes', () => {
    const html = renderMarkToHtml(
      ':::center{width=fit}\ncontent\n:::',
      defaultHtmlRegistry,
    );
    expect(html).toContain(
      '<div class="mk-layout mk-align-center mk-width-fit">',
    );
    // no outer attribute-interception div wrapped around it
    expect(html).not.toContain('<div class="mk-width-fit"><div');
  });

  it('a width wrapper takes align, the same way round', () => {
    const html = renderMarkToHtml(
      ':::fit{align=center}\ncontent\n:::',
      defaultHtmlRegistry,
    );
    expect(html).toContain(
      '<div class="mk-layout mk-width-fit mk-align-center">',
    );
  });

  it.each([
    [':::center{align=right}', 'mk-layout mk-align-center'],
    [':::fit{width=full}', 'mk-layout mk-width-fit'],
  ])(
    '%s ignores the attribute for the wrapper own axis',
    (source, expected) => {
      const html = renderMarkToHtml(
        `${source}\ncontent\n:::`,
        defaultHtmlRegistry,
      );
      expect(html).toContain(`<div class="${expected}">`);
    },
  );

  it('an invalid value on the open axis is ignored as if absent', () => {
    const html = renderMarkToHtml(
      ':::center{width=diagonal}\ncontent\n:::',
      defaultHtmlRegistry,
    );
    expect(html).toContain('<div class="mk-layout mk-align-center">');
  });

  it('never emits an author-supplied layout value into the markup', () => {
    const html = renderMarkToHtml(
      ":::center{width='javascript:alert(1)'}\ncontent\n:::",
      defaultHtmlRegistry,
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<div class="mk-layout mk-align-center">');
  });
});
