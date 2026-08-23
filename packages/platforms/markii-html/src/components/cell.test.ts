import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../escape.js';
import { Cell } from './cell.js';

const ctx = { esc: escapeHtml };

describe('Cell', () => {
  it('renders a plain unstyled div wrapping its children', () => {
    expect(Cell({}, '<p>content</p>', ctx)).toBe(
      '<div class="mk-cell"><p>content</p></div>',
    );
  });

  it('ignores attributes entirely', () => {
    expect(Cell({ foo: 'bar' }, 'x', ctx)).toBe('<div class="mk-cell">x</div>');
  });
});
