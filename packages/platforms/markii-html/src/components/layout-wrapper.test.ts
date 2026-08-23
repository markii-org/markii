import { describe, expect, it } from 'vitest';
import { createTestContext } from '../test/html-context.js';
import {
  createLayoutWrapper,
  LAYOUT_WRAPPER_PRESETS,
} from './layout-wrapper.js';

const ctx = createTestContext();

describe('createLayoutWrapper', () => {
  it.each(LAYOUT_WRAPPER_PRESETS)(
    'wraps children in mk-layout for %s',
    (preset) => {
      const wrapper = createLayoutWrapper(preset);
      expect(wrapper({}, 'hi', ctx)).toContain('mk-layout');
      expect(wrapper({}, 'hi', ctx)).toContain('hi');
    },
  );

  it('center/left/right add the matching mk-align-* class', () => {
    expect(createLayoutWrapper('center')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-align-center">x</div>',
    );
    expect(createLayoutWrapper('left')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-align-left">x</div>',
    );
    expect(createLayoutWrapper('right')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-align-right">x</div>',
    );
  });

  it('wide/narrow/full add the matching mk-width-* class', () => {
    expect(createLayoutWrapper('wide')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-width-wide">x</div>',
    );
    expect(createLayoutWrapper('narrow')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-width-narrow">x</div>',
    );
    expect(createLayoutWrapper('full')({}, 'x', ctx)).toBe(
      '<div class="mk-layout mk-width-full">x</div>',
    );
  });

  it('ignores attributes entirely', () => {
    expect(createLayoutWrapper('center')({ foo: 'bar' }, 'x', ctx)).toBe(
      '<div class="mk-layout mk-align-center">x</div>',
    );
  });
});
