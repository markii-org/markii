import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';
import {
  createLayoutWrapper,
  LAYOUT_WRAPPER_PRESETS,
  type LayoutWrapperPreset,
} from './layout-wrapper';

const EXPECTED_CLASSES: Record<LayoutWrapperPreset, string> = {
  center: 'mk-layout mk-align-center',
  left: 'mk-layout mk-align-left',
  right: 'mk-layout mk-align-right',
  wide: 'mk-layout mk-width-wide',
  narrow: 'mk-layout mk-width-narrow',
  full: 'mk-layout mk-width-full',
  fit: 'mk-layout mk-width-fit',
};

describe('createLayoutWrapper', () => {
  it.each(LAYOUT_WRAPPER_PRESETS)(
    '%s produces exactly its mapped classes on a single <div>',
    (preset) => {
      const Wrapper = createLayoutWrapper(preset);
      const { container } = render(<Wrapper attributes={{}}>x</Wrapper>);
      const el = container.firstElementChild;
      expect(el?.tagName).toBe('DIV');
      expect(el?.className).toBe(EXPECTED_CLASSES[preset]);
      // exactly one element: no extra wrapper, no stray siblings
      expect(container.children).toHaveLength(1);
    },
  );

  it('never reads attributes: an attribute-bearing invocation renders identically to an attribute-free one', () => {
    // The reserved keys are stripped by `render.tsx` before any component
    // sees them, so a `width` left in `attributes` here is just an unknown
    // attribute and must change nothing. The wrapper takes the other axis
    // through `layoutClassName` instead (see the next test).
    const Wrapper = createLayoutWrapper('center');
    const { container: withAttrs } = render(
      <Wrapper attributes={{ foo: 'bar', width: 'narrow' }}>x</Wrapper>,
    );
    const { container: withoutAttrs } = render(
      <Wrapper attributes={{}}>x</Wrapper>,
    );
    expect(withAttrs.firstElementChild?.className).toBe(
      withoutAttrs.firstElementChild?.className,
    );
  });

  it('appends layoutClassName to its own classes on the SAME div', () => {
    const Wrapper = createLayoutWrapper('center');
    const { container } = render(
      <Wrapper attributes={{}} layoutClassName="mk-width-fit">
        x
      </Wrapper>,
    );
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.className).toBe(
      'mk-layout mk-align-center mk-width-fit',
    );
  });

  it('an absent layoutClassName leaves the wrapper class untouched', () => {
    const Wrapper = createLayoutWrapper('fit');
    const { container } = render(<Wrapper attributes={{}}>x</Wrapper>);
    expect(container.firstElementChild?.className).toBe(
      'mk-layout mk-width-fit',
    );
  });

  it('does not throw and renders an empty <div> when children are absent', () => {
    const Wrapper = createLayoutWrapper('full');
    expect(() => render(<Wrapper attributes={{}} />)).not.toThrow();
    const { container } = render(<Wrapper attributes={{}} />);
    expect(container.firstElementChild?.tagName).toBe('DIV');
    expect(container.firstElementChild?.textContent).toBe('');
  });
});

describe('renderMark — layout-wrapper container directives', () => {
  it.each(LAYOUT_WRAPPER_PRESETS)(
    ':::%s renders a single div with its mapped classes',
    (preset) => {
      const { container } = render(
        renderMark(`:::${preset}\ncontent\n:::`, defaultRegistry),
      );
      const el = container.querySelector('.mk-layout');
      expect(el).not.toBeNull();
      expect(el?.className).toBe(EXPECTED_CLASSES[preset]);
    },
  );

  it('nests a width wrapper inside an alignment wrapper, composing both classes in the right order (::::center wrapping :::narrow)', () => {
    const { container } = render(
      renderMark(
        ['::::center', ':::narrow', 'nested content', ':::', '::::'].join('\n'),
        defaultRegistry,
      ),
    );
    const outer = container.querySelector(
      '.mk-layout.mk-align-center',
    ) as HTMLElement | null;
    expect(outer).not.toBeNull();
    const inner = outer?.querySelector('.mk-layout.mk-width-narrow');
    expect(inner).not.toBeNull();
    // the width wrapper is nested INSIDE the alignment wrapper, not a sibling
    expect(outer?.contains(inner as Node)).toBe(true);
    expect(inner?.textContent).toContain('nested content');
  });

  it(':::center around a GFM table renders the table untouched inside the wrapper', () => {
    const { container } = render(
      renderMark(
        [
          ':::center',
          '| Name  | Role     |',
          '| ----- | -------- |',
          '| Ada   | Engineer |',
          ':::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const wrapper = container.querySelector('.mk-layout.mk-align-center');
    expect(wrapper).not.toBeNull();
    const table = wrapper?.querySelector('table');
    expect(table).not.toBeNull();
    expect(table?.textContent).toContain('Ada');
    expect(table?.textContent).toContain('Engineer');
  });

  it(':::right around an image renders the image untouched inside the wrapper', () => {
    const { container } = render(
      renderMark(
        ':::right\n![A cat](https://example.com/cat.png)\n:::',
        defaultRegistry,
      ),
    );
    const wrapper = container.querySelector('.mk-layout.mk-align-right');
    expect(wrapper).not.toBeNull();
    const img = wrapper?.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://example.com/cat.png');
    expect(img?.getAttribute('alt')).toBe('A cat');
  });

  it(':::wide around a paragraph renders the paragraph text untouched inside the wrapper', () => {
    const { container } = render(
      renderMark(':::wide\nplain paragraph text\n:::', defaultRegistry),
    );
    const wrapper = container.querySelector('.mk-layout.mk-width-wide');
    expect(wrapper).not.toBeNull();
    const paragraph = wrapper?.querySelector('p');
    expect(paragraph?.textContent).toBe('plain paragraph text');
  });

  it('an unknown directive nested inside a wrapper still renders the unknown-directive fallback box unchanged', () => {
    const { container } = render(
      renderMark(':::center\n::totally-unregistered\n:::', defaultRegistry),
    );
    const wrapper = container.querySelector('.mk-layout.mk-align-center');
    expect(wrapper).not.toBeNull();
    const fallback = wrapper?.querySelector('.mk-unknown.mk-unknown--block');
    expect(fallback).not.toBeNull();
    expect(fallback?.textContent).toContain('totally-unregistered');
  });

  it('attributes written on a wrapper directive (other than the reserved width/align keys) are ignored', () => {
    const { container } = render(
      renderMark(':::center{foo=bar}\ncontent\n:::', defaultRegistry),
    );
    const wrapper = container.querySelector('.mk-layout');
    expect(wrapper?.className).toBe('mk-layout mk-align-center');
    expect(wrapper?.getAttribute('foo')).toBeNull();
  });

  it('an alignment wrapper takes width as an attribute, on ONE div carrying both classes', () => {
    const { container } = render(
      renderMark(':::center{width=fit}\ncontent\n:::', defaultRegistry),
    );
    expect(container.children).toHaveLength(1);
    const el = container.firstElementChild;
    expect(el?.className).toBe('mk-layout mk-align-center mk-width-fit');
    expect(el?.textContent).toContain('content');
    // no second, nested layout div — that is the whole point of the change
    expect(el?.querySelector('.mk-layout')).toBeNull();
  });

  it('a width wrapper takes align as an attribute, the same way round', () => {
    const { container } = render(
      renderMark(':::fit{align=center}\ncontent\n:::', defaultRegistry),
    );
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.className).toBe(
      'mk-layout mk-width-fit mk-align-center',
    );
  });

  it.each([
    [':::center{align=right}', 'mk-layout mk-align-center'],
    [':::right{align=left}', 'mk-layout mk-align-right'],
    [':::fit{width=full}', 'mk-layout mk-width-fit'],
    [':::narrow{width=wide}', 'mk-layout mk-width-narrow'],
  ])(
    '%s ignores the attribute for the wrapper own axis: the name wins',
    (source, expected) => {
      const { container } = render(
        renderMark(`${source}\ncontent\n:::`, defaultRegistry),
      );
      expect(container.children).toHaveLength(1);
      expect(container.firstElementChild?.className).toBe(expected);
    },
  );

  it('an invalid value on the open axis is ignored as if absent, exactly like on any other directive', () => {
    const { container } = render(
      renderMark(':::center{width=diagonal}\ncontent\n:::', defaultRegistry),
    );
    expect(container.firstElementChild?.className).toBe(
      'mk-layout mk-align-center',
    );
  });

  it('width=normal, the classless default, adds nothing to a wrapper', () => {
    const { container } = render(
      renderMark(':::center{width=normal}\ncontent\n:::', defaultRegistry),
    );
    expect(container.firstElementChild?.className).toBe(
      'mk-layout mk-align-center',
    );
  });

  it('the reserved keys never reach the wrapper as DOM attributes', () => {
    const { container } = render(
      renderMark(
        ':::center{width=fit align=right}\ncontent\n:::',
        defaultRegistry,
      ),
    );
    const el = container.firstElementChild;
    expect(el?.getAttribute('width')).toBeNull();
    expect(el?.getAttribute('align')).toBeNull();
  });

  it('nesting still means the same thing as the attribute form', () => {
    const nested = render(
      renderMark(
        ['::::center', ':::fit', 'content', ':::', '::::'].join('\n'),
        defaultRegistry,
      ),
    );
    const attributeForm = render(
      renderMark(':::center{width=fit}\ncontent\n:::', defaultRegistry),
    );
    // Two elements vs one: the nested spelling is not byte-identical, but
    // both put `mk-align-center` and `mk-width-fit` over the same content.
    expect(
      nested.container.querySelector('.mk-layout.mk-align-center'),
    ).not.toBeNull();
    expect(
      nested.container.querySelector('.mk-layout.mk-width-fit'),
    ).not.toBeNull();
    expect(attributeForm.container.firstElementChild?.className).toBe(
      'mk-layout mk-align-center mk-width-fit',
    );
  });

  it(':::narrow with an empty body does not throw and renders an empty wrapper div', () => {
    expect(() =>
      render(renderMark(':::narrow\n:::', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(renderMark(':::narrow\n:::', defaultRegistry));
    const wrapper = container.querySelector('.mk-layout.mk-width-narrow');
    expect(wrapper).not.toBeNull();
  });
});
