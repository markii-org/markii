import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

describe('Details', () => {
  it('renders folded by default, with the default title', () => {
    const { container } = render(
      renderMark(':::details\nhidden body\n:::', defaultRegistry),
    );
    const details = container.querySelector('details.mk-details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details?.querySelector('.mk-details__summary')).toHaveTextContent(
      'Details',
    );
    expect(details).toHaveTextContent('hidden body');
  });

  it('uses the title attribute when given', () => {
    const { container } = render(
      renderMark(':::details{title="More info"}\nbody\n:::', defaultRegistry),
    );
    expect(container.querySelector('.mk-details__summary')).toHaveTextContent(
      'More info',
    );
  });

  it('starts expanded when the bare `open` attribute is present', () => {
    const { container } = render(
      renderMark(':::details{open}\nbody\n:::', defaultRegistry),
    );
    expect(container.querySelector('details.mk-details')).toHaveAttribute(
      'open',
    );
  });

  it('renders the directive body as rich markdown', () => {
    const { container } = render(
      renderMark(':::details\n**bold** body\n:::', defaultRegistry),
    );
    expect(
      container.querySelector('.mk-details__body strong'),
    ).toHaveTextContent('bold');
  });
});
