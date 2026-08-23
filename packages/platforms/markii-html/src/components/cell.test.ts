import { describe, expect, it } from 'vitest';
import { createTestContext } from '../test/html-context.js';
import { Cell } from './cell.js';

const ctx = createTestContext();

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
