import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

// Directive container nesting requires the outer fence to use MORE colons
// than its nested children, hence `::::tabs` wrapping `:::tab` (matching
// DESIGN.md's own nested-callout fixture, `::::callout` wrapping `:::callout`).
const TWO_TABS = [
  '::::tabs',
  ':::tab{label="First"}',
  'Panel one content.',
  ':::',
  ':::tab{label="Second"}',
  'Panel two content.',
  ':::',
  '::::',
].join('\n');

describe('Tabs', () => {
  it('renders a tablist button per tab and defaults to showing the first panel', () => {
    const { container } = render(renderMark(TWO_TABS, defaultRegistry));
    const tabs = container.querySelector('.mk-tabs');
    expect(tabs).not.toBeNull();

    const buttons = tabs?.querySelectorAll('[role="tab"]') ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('First');
    expect(buttons[1]).toHaveTextContent('Second');
    expect(buttons[0]).toHaveAttribute('aria-selected', 'true');
    expect(buttons[1]).toHaveAttribute('aria-selected', 'false');

    expect(tabs?.querySelector('[role="tabpanel"]')).toHaveTextContent(
      'Panel one content.',
    );
    expect(tabs).not.toHaveTextContent('Panel two content.');
  });

  it('switches the visible panel when a different tab button is clicked', () => {
    const { container } = render(renderMark(TWO_TABS, defaultRegistry));
    const tabs = container.querySelector('.mk-tabs') as HTMLElement;
    const buttons = tabs.querySelectorAll('[role="tab"]');

    fireEvent.click(buttons[1] as Element);

    expect(tabs.querySelector('[role="tabpanel"]')).toHaveTextContent(
      'Panel two content.',
    );
    expect(tabs).not.toHaveTextContent('Panel one content.');
    expect(buttons[0]).toHaveAttribute('aria-selected', 'false');
    expect(buttons[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('handles a single tab (no crash, one button, its panel shown)', () => {
    const { container } = render(
      renderMark(
        [
          '::::tabs',
          ':::tab{label="Only"}',
          'Only content.',
          ':::',
          '::::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const tabs = container.querySelector('.mk-tabs');
    expect(tabs?.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(tabs).toHaveTextContent('Only content.');
  });

  it('renders nothing for zero tabs, rather than an empty shell or a throw', () => {
    expect(() =>
      render(renderMark('::::tabs\n::::', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(renderMark('::::tabs\n::::', defaultRegistry));
    expect(container.querySelector('.mk-tabs')).toBeNull();
  });

  it('ignores a non-tab child rather than throwing or crashing the panel bar', () => {
    const { container } = render(
      renderMark(
        [
          '::::tabs',
          'Some stray prose, not a tab.',
          ':::tab{label="Real"}',
          'real content',
          ':::',
          '::::',
        ].join('\n'),
        defaultRegistry,
      ),
    );
    const tabs = container.querySelector('.mk-tabs');
    expect(tabs?.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(tabs?.querySelector('[role="tab"]')).toHaveTextContent('Real');
  });

  it('a standalone tab directive (no tabs parent) still renders its own panel', () => {
    const { container } = render(
      renderMark(':::tab{label="Solo"}\nsolo content\n:::', defaultRegistry),
    );
    const panel = container.querySelector('.mk-tab');
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('role', 'tabpanel');
    expect(panel).toHaveTextContent('solo content');
  });

  it('defaults a tab with no label attribute to "Tab"', () => {
    const { container } = render(
      renderMark(
        ['::::tabs', ':::tab', 'content', ':::', '::::'].join('\n'),
        defaultRegistry,
      ),
    );
    expect(container.querySelector('.mk-tabs [role="tab"]')).toHaveTextContent(
      'Tab',
    );
  });
});
