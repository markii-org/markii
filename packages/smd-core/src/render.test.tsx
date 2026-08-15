import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderSmd } from './render';
import { defaultRegistry } from './components';
import type { Registry } from './registry';

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
    expect(callouts).toHaveLength(3);
    expect(callouts[0]).toHaveClass('smd-callout--warning');
    expect(callouts[0]).toHaveTextContent('Quoted title with spaces');
    expect(callouts[1]).toHaveClass('smd-callout--danger');
    expect(callouts[2]).toHaveClass('smd-callout--info');
  });

  it('renders directives nested inside directives', () => {
    const { container } = renderFixture('06-nested-directives.smd');
    const callouts = container.querySelectorAll('.smd-callout');
    expect(callouts).toHaveLength(2);
    const outer = callouts[0];
    expect(outer).toHaveClass('smd-callout--info');
    expect(outer?.querySelector('.smd-callout--warning')).not.toBeNull();
    expect(outer?.querySelector('.smd-rating')).not.toBeNull();
    expect(outer?.querySelector('kbd.smd-kbd')).toHaveTextContent('Enter');
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

  it('never throws for a directive name that collides with nothing registered', () => {
    expect(() => renderSmd(':::mystery\nhi\n:::', {})).not.toThrow();
    const { container } = render(renderSmd(':::mystery\nhi\n:::', {}));
    expect(container.querySelector('.smd-unknown')).not.toBeNull();
  });
});
