import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

describe('Badge', () => {
  it('defaults to the neutral variant when no variant attribute is given', () => {
    const { container } = render(renderMark(':badge[New]', defaultRegistry));
    const badge = container.querySelector('.mk-badge');
    expect(badge).not.toBeNull();
    expect(badge).toHaveClass('mk-badge--neutral');
    expect(badge).toHaveTextContent('New');
  });

  it('applies the requested variant class', () => {
    const { container } = render(
      renderMark(':badge[Shipped]{variant=success}', defaultRegistry),
    );
    expect(container.querySelector('.mk-badge')).toHaveClass(
      'mk-badge--success',
    );
  });

  it('falls back to neutral for an invalid/unknown variant rather than throwing', () => {
    expect(() =>
      render(renderMark(':badge[Odd]{variant=nonsense}', defaultRegistry)),
    ).not.toThrow();
    const { container } = render(
      renderMark(':badge[Odd]{variant=nonsense}', defaultRegistry),
    );
    expect(container.querySelector('.mk-badge')).toHaveClass(
      'mk-badge--neutral',
    );
  });

  it('renders inline (a <span>, sitting inside surrounding text)', () => {
    const { container } = render(
      renderMark('Status: :badge[Beta]{variant=info} today.', defaultRegistry),
    );
    const badge = container.querySelector('.mk-badge');
    expect(badge?.tagName).toBe('SPAN');
    expect(container.querySelector('p')).toHaveTextContent(
      'Status: Beta today.',
    );
  });
});
