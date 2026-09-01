import { describe, expect, it } from 'vitest';
import { TEXT_ALIGN_PRESETS } from '@markii/stdlib';
import { createTestContext } from '../test/html-context.js';
import { Cell } from './cell.js';

const ctx = createTestContext();

describe('Cell', () => {
  it('renders a plain unstyled div wrapping its children', () => {
    expect(Cell({}, '<p>content</p>', ctx)).toBe(
      '<div class="mk-cell"><p>content</p></div>',
    );
  });

  it('ignores an attribute it does not declare', () => {
    expect(Cell({ foo: 'bar' }, 'x', ctx)).toBe('<div class="mk-cell">x</div>');
  });
});

describe('Cell — text', () => {
  it.each(TEXT_ALIGN_PRESETS)(
    'text=%s appends the matching mk-text-* class, overriding the enclosing row by declaring a value',
    (text) => {
      expect(Cell({ text }, 'x', ctx)).toBe(
        `<div class="mk-cell mk-text-${text}">x</div>`,
      );
    },
  );

  it('ignores an invalid or bare text value', () => {
    expect(Cell({ text: 'diagonal' }, 'x', ctx)).toBe(
      '<div class="mk-cell">x</div>',
    );
    expect(Cell({ text: null }, 'x', ctx)).toBe('<div class="mk-cell">x</div>');
  });
});
