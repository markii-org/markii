import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from '../render';
import { defaultRegistry } from './index';

describe('Card', () => {
  it('renders title and body when a title is given', () => {
    const { container } = render(
      renderMark(':::card{title="Notes"}\nsome body\n:::', defaultRegistry),
    );
    const card = container.querySelector('.mk-card');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.mk-card__title')).toHaveTextContent('Notes');
    expect(card?.querySelector('.mk-card__body')).toHaveTextContent(
      'some body',
    );
  });

  it('omits the title element entirely when no title is given', () => {
    const { container } = render(
      renderMark(':::card\nsome body\n:::', defaultRegistry),
    );
    const card = container.querySelector('.mk-card');
    expect(card?.querySelector('.mk-card__title')).toBeNull();
    expect(card?.querySelector('.mk-card__body')).toHaveTextContent(
      'some body',
    );
  });

  it('renders the body as rich markdown', () => {
    const { container } = render(
      renderMark(':::card\n- one\n- two\n:::', defaultRegistry),
    );
    expect(container.querySelectorAll('.mk-card__body li')).toHaveLength(2);
  });
});
