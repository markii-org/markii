import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parse } from '@markii/core';
import type { ReactElement } from 'react';
import { renderMark, renderMarkNode } from './render';
import { defaultRegistry } from './components';
import { createRegistry, type MarkComponentProps } from './registry';
import { UnknownDirective } from './components/unknown-directive';

/** A block-shaped component (emits a `<div>`) — invalid inside a paragraph. */
function Box({ children }: MarkComponentProps): ReactElement {
  return <div className="probe-box">{children}</div>;
}

/** An inline-shaped component (emits a `<span>`) — valid anywhere. */
function Chip({ children }: MarkComponentProps): ReactElement {
  return <span className="probe-chip">{children}</span>;
}

/**
 * The three registrations the rule can see: an explicit block component, an
 * explicit inline component, and a plain registration that says nothing
 * about kind (the compatibility case that must keep working unchanged).
 */
const registry = createRegistry({
  box: { component: Box, inline: false },
  chip: { component: Chip, inline: true },
  quiet: { component: Box },
});

/** The three directive forms, written for `name`. */
const forms = {
  inline: (name: string) => `before :${name}[body] after`,
  leaf: (name: string) => `::${name}{}`,
  container: (name: string) => `:::${name}\nbody\n:::`,
};

function html(source: string, reg = registry): HTMLElement {
  return render(renderMark(source, reg)).container;
}

describe('form/kind mismatch — a block component written inline', () => {
  it('degrades to the fallback INSTEAD of rendering the component', () => {
    const container = html(forms.inline('box'));
    expect(container.querySelector('.probe-box')).toBeNull();
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback?.tagName).toBe('SPAN');
    expect(fallback?.className).toBe(
      'mk-unknown mk-unknown--inline mk-unknown--mismatch',
    );
    expect(fallback?.textContent).toContain('block component');
    expect(fallback?.textContent).toContain('box');
    expect(fallback?.textContent).toContain('written inline');
  });

  it('keeps the directive body and the surrounding prose', () => {
    const container = html(forms.inline('box'));
    expect(container.textContent).toContain('before');
    expect(container.textContent).toContain('body');
    expect(container.textContent).toContain('after');
  });

  it('emits NO block element inside the paragraph (the div-in-p bug)', () => {
    const container = html(forms.inline('box'));
    expect(container.querySelectorAll('p div')).toHaveLength(0);
    expect(container.querySelectorAll('p > *')).not.toHaveLength(0);
  });

  it.each([
    'center',
    'right',
    'wide',
    'narrow',
    'full',
    'row',
    'callout',
    'card',
    'details',
    'figure',
    'tabs',
    'tab',
    'cell',
  ])('holds for the standard block component %s in defaultRegistry', (name) => {
    const container = html(forms.inline(name), defaultRegistry);
    expect(container.querySelectorAll('p div')).toHaveLength(0);
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback?.tagName).toBe('SPAN');
    expect(fallback?.className).toContain('mk-unknown--mismatch');
  });

  it.each(['stat', 'progress', 'chart', 'rating'])(
    'holds for the standard leaf component %s in defaultRegistry',
    (name) => {
      const container = html(`before :${name}[x] after`, defaultRegistry);
      const fallback = container.querySelector('.mk-unknown');
      expect(fallback?.tagName).toBe('SPAN');
      expect(fallback?.className).toContain('mk-unknown--mismatch');
    },
  );

  it('still strips the reserved layout attributes and adds no wrapper', () => {
    const container = html(
      ':x[b]{width=wide align=center}'.replace('x', 'box'),
    );
    expect(container.querySelector('.mk-width-wide')).toBeNull();
    expect(container.querySelector('.mk-align-center')).toBeNull();
    expect(container.querySelector('.mk-unknown--mismatch')).not.toBeNull();
  });

  it('reports a registry alias under its TARGET name, like every other fallback', () => {
    const aliased = createRegistry(
      { box: { component: Box, inline: false } },
      {
        hero: { name: 'box' },
      },
    );
    const container = html('before :hero[body] after', aliased);
    expect(container.querySelector('.probe-box')).toBeNull();
    expect(container.querySelector('.mk-unknown')?.textContent).toContain(
      'box',
    );
  });
});

describe('form/kind mismatch — the permissive directions', () => {
  it.each(['leaf', 'container'] as const)(
    'a block component written as a %s directive renders normally',
    (form) => {
      const container = html(forms[form]('box'));
      expect(container.querySelector('.probe-box')).not.toBeNull();
      expect(container.querySelector('.mk-unknown')).toBeNull();
    },
  );

  it('an inline component written inline renders normally', () => {
    const container = html(forms.inline('chip'));
    expect(container.querySelector('.probe-chip')).not.toBeNull();
    expect(container.querySelector('.mk-unknown')).toBeNull();
  });

  /*
   * The reverse direction stays permissive on purpose (see `isFormMismatch`):
   * phrasing content in block flow is parsed exactly as written and round
   * trips, unlike a `<div>` in a `<p>`, so degrading it would cost the
   * author their content for no correctness gain. Pinned here so the choice
   * is a decision rather than an accident.
   */
  it.each(['leaf', 'container'] as const)(
    'an inline component written as a %s directive still renders (permissive)',
    (form) => {
      const container = html(forms[form]('chip'));
      expect(container.querySelector('.probe-chip')).not.toBeNull();
      expect(container.querySelector('.mk-unknown')).toBeNull();
    },
  );

  it.each(['kbd', 'badge'])(
    'holds for the standard inline component %s in defaultRegistry',
    (name) => {
      const container = html(forms.container(name), defaultRegistry);
      expect(container.querySelector('.mk-unknown')).toBeNull();
      expect(container.textContent).toContain('body');
    },
  );

  it.each(['inline', 'leaf', 'container'] as const)(
    'a registration with NO inline flag keeps working unchanged in %s form',
    (form) => {
      const container = html(forms[form]('quiet'));
      expect(container.querySelector('.probe-box')).not.toBeNull();
      expect(container.querySelector('.mk-unknown')).toBeNull();
    },
  );

  it.each([
    ['the string "false"', 'false'],
    ['zero', 0],
    ['null', null],
  ])(
    'a non-boolean inline flag (%s) is not kind information and renders',
    (_label, value) => {
      const hostile = createRegistry({
        box: { component: Box, inline: value as unknown as boolean },
      });
      const container = html(forms.inline('box'), hostile);
      expect(container.querySelector('.probe-box')).not.toBeNull();
      expect(container.querySelector('.mk-unknown')).toBeNull();
    },
  );

  /*
   * The kind check is a NEW property read on a host-supplied object, so it
   * must not become a new way for a hostile registry to escape React's
   * render phase (docs/spec.md requirement 4). A read that fails is kind
   * information we do not have, so it fails permissive.
   */
  it('does not throw when the entry has a throwing inline getter', () => {
    const entry = { component: Box };
    Object.defineProperty(entry, 'inline', {
      get() {
        throw new Error('hostile getter');
      },
      enumerable: true,
    });
    const hostile = createRegistry({ box: entry as never });
    expect(() => html(forms.inline('box'), hostile)).not.toThrow();
    expect(
      html(forms.inline('box'), hostile).querySelector('.probe-box'),
    ).not.toBeNull();
  });
});

describe('inline fallback element — no div-in-p for any inline directive', () => {
  it.each([
    ['nope', 'an unregistered name'],
    ['constructor', 'a prototype member'],
    ['toString', 'an inherited method'],
    ['hasOwnProperty', 'another inherited method'],
    ['valueOf', 'yet another inherited method'],
  ])('%s (%s) falls back to a span, in-paragraph', (name) => {
    const container = html(`before :${name}[body] after`, defaultRegistry);
    expect(container.querySelectorAll('p div')).toHaveLength(0);
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback?.tagName).toBe('SPAN');
    expect(fallback?.className).toBe('mk-unknown mk-unknown--inline');
    expect(fallback?.textContent).toContain('unknown component');
  });

  it.each([
    ['nope', 'an unregistered name'],
    ['constructor', 'a prototype member'],
  ])('%s (%s) still falls back to the block box in block form', (name) => {
    const container = html(`::${name}{}`, defaultRegistry);
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback?.tagName).toBe('DIV');
    expect(fallback?.className).toBe('mk-unknown mk-unknown--block');
  });

  /*
   * `:__proto__[x]` cannot reach the renderer at all: a directive name must
   * start with an ASCII letter, so micromark never opens a directive and the
   * `__` is read as ordinary strong emphasis. Pinned so the absence of a
   * `__proto__` case above reads as a fact about the grammar rather than an
   * oversight.
   */
  it('never even parses :__proto__[x] as a directive', () => {
    const container = html('before :__proto__[body] after', defaultRegistry);
    expect(container.querySelector('.mk-unknown')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('proto');
  });

  it('never throws for any of the hostile inline names', () => {
    for (const name of [
      'constructor',
      'toString',
      'hasOwnProperty',
      'valueOf',
      'box',
    ]) {
      expect(() => render(renderMark(`:${name}[x]`, registry))).not.toThrow();
    }
  });
});

describe('renderMark / renderMarkNode parity', () => {
  const sources = [
    'before :box[body] after',
    'before :nope[body] after',
    'before :constructor[body] after',
    'before :chip[body] after',
    '::box{}',
    ':::box\nbody\n:::',
    ':::chip\nbody\n:::',
  ];

  it.each(sources)('renders %s identically node-by-node', (source) => {
    const documentHtml = render(renderMark(source, registry)).container
      .innerHTML;
    const nodeHtml = parse(source)
      .children.map(
        (node) => render(renderMarkNode(node, registry)).container.innerHTML,
      )
      .join('');
    expect(nodeHtml).toBe(documentHtml);
  });
});

describe('UnknownDirective — fallback reasons', () => {
  it('defaults to the unregistered wording', () => {
    const { container } = render(
      <UnknownDirective name="x">b</UnknownDirective>,
    );
    expect(container.textContent).toContain('unknown component');
    expect(container.firstElementChild?.className).toBe(
      'mk-unknown mk-unknown--block',
    );
  });

  it('words a block-form mismatch for the other direction too', () => {
    const { container } = render(
      <UnknownDirective name="chip" reason="form-mismatch">
        b
      </UnknownDirective>,
    );
    expect(container.textContent).toContain('inline component');
    expect(container.textContent).toContain('written as a block');
    expect(container.firstElementChild?.className).toBe(
      'mk-unknown mk-unknown--block mk-unknown--mismatch',
    );
  });

  it('keeps the inner content in both reasons and both forms', () => {
    for (const reason of ['unregistered', 'form-mismatch'] as const) {
      for (const inline of [true, false]) {
        const { container } = render(
          <UnknownDirective name="x" inline={inline} reason={reason}>
            kept
          </UnknownDirective>,
        );
        expect(container.textContent).toContain('kept');
      }
    }
  });
});
