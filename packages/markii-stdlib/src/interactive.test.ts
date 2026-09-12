import { describe, expect, it } from 'vitest';
import { INTERACTIVE_ATTRIBUTE } from './interactive.js';

describe('INTERACTIVE_ATTRIBUTE', () => {
  it('is the documented data attribute name', () => {
    expect(INTERACTIVE_ATTRIBUTE).toBe('data-mk-interactive');
  });
});
