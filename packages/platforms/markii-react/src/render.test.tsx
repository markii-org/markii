import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forwardRef, memo } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { conformanceDir } from '@markii/core/corpus';
import { renderSmd } from './render';
import { defaultRegistry } from './components';
import type {
  DirectiveAttributes,
  Registry,
  SmdComponentProps,
} from './registry';

function readFixture(name: string): string {
  return readFileSync(join(conformanceDir(), name), 'utf8');
}

function renderFixture(name: string, registry: Registry = defaultRegistry) {
  return render(renderSmd(readFixture(name), registry));
}

describe('renderSmd', () => {
  it('renders plain markdown passthrough with no components involved', () => {
    const { container } = renderFixture('01-plain-markdown.mk.md');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Plain markdown passthrough',
    );
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'a link' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });

  it('renders the built-in kbd component for inline text directives', () => {
    const { container } = renderFixture('02-inline-directive.mk.md');
    const keys = container.querySelectorAll('kbd.mk-kbd');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toHaveTextContent('Ctrl+S');
    expect(keys[1]).toHaveTextContent('Cmd+Shift+P');
  });

  it('renders the built-in rating component for a leaf directive, clamped', () => {
    renderFixture('03-leaf-directive.mk.md');
    const rating = screen.getByRole('img', { name: 'rating: 3 out of 5' });
    expect(rating.querySelectorAll('.mk-rating__star')).toHaveLength(5);
    expect(rating.querySelectorAll('.mk-rating__star--filled')).toHaveLength(3);
  });

  it('renders the built-in callout component for a container directive', () => {
    const { container } = renderFixture('04-container-directive.mk.md');
    const callout = container.querySelector('.mk-callout--warning');
    expect(callout).not.toBeNull();
    expect(callout).toHaveTextContent('Careful');
    expect(screen.getByRole('link', { name: 'link' })).toBeInTheDocument();
  });

  it('handles quoted, bare, and missing attributes gracefully', () => {
    const { container } = renderFixture('05-attributes.mk.md');
    const callouts = container.querySelectorAll('.mk-callout');
    expect(callouts).toHaveLength(4);
    expect(callouts[0]).toHaveClass('mk-callout--warning');
    expect(callouts[0]).toHaveTextContent('Quoted title with spaces');
    expect(callouts[1]).toHaveClass('mk-callout--danger');
    expect(callouts[2]).toHaveClass('mk-callout--info');
    expect(callouts[3]).toHaveClass('mk-callout--info');
    expect(callouts[3]).toHaveTextContent('bare (valueless) attribute');
  });

  it('renders directives nested inside directives, with no stray fence markers', () => {
    const { container } = renderFixture('06-nested-directives.mk.md');
    const callouts = container.querySelectorAll('.mk-callout');
    expect(callouts).toHaveLength(2);
    const outer = callouts[0];
    expect(outer).toHaveClass('mk-callout--info');
    expect(outer?.querySelector('.mk-callout--warning')).not.toBeNull();
    expect(outer?.querySelector('.mk-rating')).not.toBeNull();
    expect(outer?.querySelector('kbd.mk-kbd')).toHaveTextContent('Enter');
    // A malformed fixture (equal fence lengths on the outer/inner callout)
    // would leave a literal ":::" paragraph in the output where the outer
    // closes early; the fixture uses a longer outer fence (::::) precisely
    // so no such stray marker text ever reaches the rendered document.
    expect(container.textContent ?? '').not.toContain(':::');
  });

  it('renders a fallback box for unknown directives, block and inline', () => {
    const { container } = renderFixture('07-unknown-directive.mk.md');
    const fallbacks = container.querySelectorAll('.mk-unknown');
    expect(fallbacks).toHaveLength(3);

    const inlineFallback = container.querySelector('.mk-unknown--inline');
    expect(inlineFallback?.tagName).toBe('SPAN');
    expect(inlineFallback).toHaveTextContent('unknown component');
    expect(inlineFallback).toHaveTextContent('badge');

    const blockFallbacks = container.querySelectorAll('.mk-unknown--block');
    expect(blockFallbacks).toHaveLength(2);
    const names = Array.from(blockFallbacks).map((el) => el.textContent ?? '');
    expect(names.some((text) => text.includes('timeline'))).toBe(true);
    expect(names.some((text) => text.includes('widget'))).toBe(true);
  });

  it('does not render directive-like text inside a code fence as a component', () => {
    const { container } = renderFixture('08-code-fence.mk.md');
    expect(container.querySelectorAll('.mk-callout')).toHaveLength(1);
    expect(container.querySelector('.mk-callout')).toHaveTextContent('Real');

    const codeBlock = container.querySelector('pre code');
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.textContent ?? '').toContain(
      ':::callout{type=warning title="Not real"}',
    );
    expect(codeBlock?.textContent ?? '').toContain(':kbd[Ctrl+S]');

    const inlineCode = screen.getByText(':kbd[literal]');
    expect(inlineCode.tagName).toBe('CODE');
  });

  it('does not throw on a malformed, unclosed container directive', () => {
    expect(() => renderFixture('09-malformed-container.mk.md')).not.toThrow();
    const { container } = renderFixture('09-malformed-container.mk.md');
    expect(container.querySelector('.mk-callout--danger')).not.toBeNull();
  });

  it('never throws for a directive name that collides with an inherited Object.prototype member', () => {
    expect(() => renderSmd(':::constructor\nhi\n:::', {})).not.toThrow();
    const { container } = render(renderSmd(':::constructor\nhi\n:::', {}));
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback).not.toBeNull();
    expect(fallback).toHaveTextContent('constructor');
  });

  it('renders the fallback box (not a blank document) for every directive name that collides with an inherited Object.prototype member', () => {
    const { container } = renderFixture('10-prototype-names.mk.md', {});
    const fallbacks = container.querySelectorAll('.mk-unknown');
    expect(fallbacks).toHaveLength(4);
    const names = Array.from(fallbacks).map((el) => el.textContent ?? '');
    expect(names.some((text) => text.includes('constructor'))).toBe(true);
    expect(names.some((text) => text.includes('toString'))).toBe(true);
    expect(names.some((text) => text.includes('hasOwnProperty'))).toBe(true);
    expect(names.some((text) => text.includes('valueOf'))).toBe(true);

    // The rest of the document must still render — a prototype-chain
    // collision on one directive must not blank the whole note.
    expect(container.querySelector('h1')).toHaveTextContent(
      'Prototype-name directives',
    );
    expect(container.textContent ?? '').toContain(
      'Normal paragraph after all four collisions',
    );
  });

  it('normalizes bare attributes to null (not empty string) for registry components', () => {
    let seenAttributes: DirectiveAttributes | undefined;
    const probeRegistry: Registry = {
      probe: {
        component: ({ attributes }: SmdComponentProps) => {
          seenAttributes = attributes;
          return null;
        },
        inline: false,
      },
    };

    render(renderSmd('::probe{collapsed src="a.json"}', probeRegistry));

    expect(seenAttributes).toEqual({ collapsed: null, src: 'a.json' });
  });

  it('renders a React.memo-wrapped component, not the unknown-directive fallback', () => {
    // `typeof` a memoized component is `'object'`, not `'function'` — a
    // regression here would silently fall through to the fallback box
    // instead of rendering the registered component.
    const MemoProbe = memo(function MemoProbe({ children }: SmdComponentProps) {
      return <div className="memo-probe">{children}</div>;
    });
    const registry: Registry = { memoprobe: { component: MemoProbe } };

    const { container } = render(
      renderSmd(':::memoprobe\nhello\n:::', registry),
    );

    expect(container.querySelector('.memo-probe')).toHaveTextContent('hello');
    expect(container.querySelector('.mk-unknown')).toBeNull();
  });

  it('renders a React.forwardRef-wrapped component, not the unknown-directive fallback', () => {
    // Same `typeof === 'object'` hazard as React.memo, via a different API.
    const ForwardRefProbe = forwardRef<HTMLDivElement, SmdComponentProps>(
      function ForwardRefProbe({ children }, ref) {
        return (
          <div ref={ref} className="forwardref-probe">
            {children}
          </div>
        );
      },
    );
    const registry: Registry = {
      forwardrefprobe: { component: ForwardRefProbe },
    };

    const { container } = render(
      renderSmd(':::forwardrefprobe\nhello\n:::', registry),
    );

    expect(container.querySelector('.forwardref-probe')).toHaveTextContent(
      'hello',
    );
    expect(container.querySelector('.mk-unknown')).toBeNull();
  });
});

// URL-sanitization behavior is a `toHast` (@markii/core) concern and is tested
// at the hast level in @markii/core's `to-hast.test.ts` — no React/jsdom
// involved there. This file only covers React-facing rendering behavior.
