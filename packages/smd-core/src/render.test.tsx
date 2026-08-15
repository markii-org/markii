import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderSmd } from './render';
import { defaultRegistry } from './components';
import type {
  DirectiveAttributes,
  Registry,
  SmdComponentProps,
} from './registry';

function readFixture(name: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', name), 'utf8');
}

function renderFixture(name: string, registry: Registry = defaultRegistry) {
  return render(renderSmd(readFixture(name), registry));
}

describe('renderSmd', () => {
  it('renders plain markdown passthrough with no components involved', () => {
    const { container } = renderFixture('01-plain-markdown.smd');
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
    const { container } = renderFixture('02-inline-directive.smd');
    const keys = container.querySelectorAll('kbd.smd-kbd');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toHaveTextContent('Ctrl+S');
    expect(keys[1]).toHaveTextContent('Cmd+Shift+P');
  });

  it('renders the built-in rating component for a leaf directive, clamped', () => {
    renderFixture('03-leaf-directive.smd');
    const rating = screen.getByRole('img', { name: 'rating: 3 out of 5' });
    expect(rating.querySelectorAll('.smd-rating__star')).toHaveLength(5);
    expect(rating.querySelectorAll('.smd-rating__star--filled')).toHaveLength(
      3,
    );
  });

  it('renders the built-in callout component for a container directive', () => {
    const { container } = renderFixture('04-container-directive.smd');
    const callout = container.querySelector('.smd-callout--warning');
    expect(callout).not.toBeNull();
    expect(callout).toHaveTextContent('Careful');
    expect(screen.getByRole('link', { name: 'link' })).toBeInTheDocument();
  });

  it('handles quoted, bare, and missing attributes gracefully', () => {
    const { container } = renderFixture('05-attributes.smd');
    const callouts = container.querySelectorAll('.smd-callout');
    expect(callouts).toHaveLength(4);
    expect(callouts[0]).toHaveClass('smd-callout--warning');
    expect(callouts[0]).toHaveTextContent('Quoted title with spaces');
    expect(callouts[1]).toHaveClass('smd-callout--danger');
    expect(callouts[2]).toHaveClass('smd-callout--info');
    expect(callouts[3]).toHaveClass('smd-callout--info');
    expect(callouts[3]).toHaveTextContent('bare (valueless) attribute');
  });

  it('renders directives nested inside directives, with no stray fence markers', () => {
    const { container } = renderFixture('06-nested-directives.smd');
    const callouts = container.querySelectorAll('.smd-callout');
    expect(callouts).toHaveLength(2);
    const outer = callouts[0];
    expect(outer).toHaveClass('smd-callout--info');
    expect(outer?.querySelector('.smd-callout--warning')).not.toBeNull();
    expect(outer?.querySelector('.smd-rating')).not.toBeNull();
    expect(outer?.querySelector('kbd.smd-kbd')).toHaveTextContent('Enter');
    // A malformed fixture (equal fence lengths on the outer/inner callout)
    // would leave a literal ":::" paragraph in the output where the outer
    // closes early; the fixture uses a longer outer fence (::::) precisely
    // so no such stray marker text ever reaches the rendered document.
    expect(container.textContent ?? '').not.toContain(':::');
  });

  it('renders a fallback box for unknown directives, block and inline', () => {
    const { container } = renderFixture('07-unknown-directive.smd');
    const fallbacks = container.querySelectorAll('.smd-unknown');
    expect(fallbacks).toHaveLength(3);

    const inlineFallback = container.querySelector('.smd-unknown--inline');
    expect(inlineFallback?.tagName).toBe('SPAN');
    expect(inlineFallback).toHaveTextContent('unknown component');
    expect(inlineFallback).toHaveTextContent('badge');

    const blockFallbacks = container.querySelectorAll('.smd-unknown--block');
    expect(blockFallbacks).toHaveLength(2);
    const names = Array.from(blockFallbacks).map((el) => el.textContent ?? '');
    expect(names.some((text) => text.includes('timeline'))).toBe(true);
    expect(names.some((text) => text.includes('widget'))).toBe(true);
  });

  it('does not render directive-like text inside a code fence as a component', () => {
    const { container } = renderFixture('08-code-fence.smd');
    expect(container.querySelectorAll('.smd-callout')).toHaveLength(1);
    expect(container.querySelector('.smd-callout')).toHaveTextContent('Real');

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
    expect(() => renderFixture('09-malformed-container.smd')).not.toThrow();
    const { container } = renderFixture('09-malformed-container.smd');
    expect(container.querySelector('.smd-callout--danger')).not.toBeNull();
  });

  it('never throws for a directive name that collides with an inherited Object.prototype member', () => {
    expect(() => renderSmd(':::constructor\nhi\n:::', {})).not.toThrow();
    const { container } = render(renderSmd(':::constructor\nhi\n:::', {}));
    const fallback = container.querySelector('.smd-unknown');
    expect(fallback).not.toBeNull();
    expect(fallback).toHaveTextContent('constructor');
  });

  it('renders the fallback box (not a blank document) for every directive name that collides with an inherited Object.prototype member', () => {
    const { container } = renderFixture('10-prototype-names.smd', {});
    const fallbacks = container.querySelectorAll('.smd-unknown');
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
});

describe('URL sanitization', () => {
  it('neutralizes a javascript: URL in a link href but keeps the link text', () => {
    const { container } = render(
      renderSmd('[click me](javascript:alert(1))', {}),
    );
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent('click me');
    expect(link).not.toHaveAttribute('href');
  });

  it('neutralizes uppercase and whitespace-padded javascript: URLs', () => {
    const mixedCase = render(renderSmd('[click me](JaVaScRiPt:alert(1))', {}));
    expect(mixedCase.container.querySelector('a')).not.toHaveAttribute('href');

    // `&#32;` is a decoded character reference, so the destination the
    // parser hands us is the literal string " JaVaScRiPt:alert(1)" (real
    // leading space, mixed case) — proves the scheme check is a strict
    // match, not a `startsWith('javascript:')` check a leading space (or
    // case change) could sneak past.
    const padded = render(renderSmd('[again](<&#32;JaVaScRiPt:alert(1)>)', {}));
    expect(padded.container.querySelector('a')).not.toHaveAttribute('href');
  });

  it('neutralizes a data: URL in an image src but keeps the image element', () => {
    const { container } = render(
      renderSmd('![alt text](data:text/html,alert(1))', {}),
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('alt', 'alt text');
    expect(img).not.toHaveAttribute('src');
  });

  it('preserves http, https, mailto, tel, relative, fragment, and query URLs', () => {
    const cases: Array<[string, string]> = [
      ['https link', 'https://example.com'],
      ['http link', 'http://example.com'],
      ['mailto link', 'mailto:person@example.com'],
      ['tel link', 'tel:+15555550100'],
      ['relative link', '/notes/today'],
      ['fragment link', '#section'],
      ['query link', '?tab=info'],
    ];
    for (const [text, url] of cases) {
      const { container } = render(renderSmd(`[${text}](${url})`, {}));
      expect(container.querySelector('a')).toHaveAttribute('href', url);
    }
  });
});
