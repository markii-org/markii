import { describe, expect, it } from 'vitest';
import {
  formMismatchMessage,
  invalidAttributeValueMessage,
} from '@markii/stdlib';
import {
  formMismatchTitle,
  invalidAttributeValueTitle,
} from './failure-presentation.js';

describe('wording shared with the note validator', () => {
  it('words a form mismatch the way the validator does', () => {
    expect(formMismatchTitle('callout')).toBe(formMismatchMessage('callout'));
  });

  it('words an invalid attribute value the way the validator does', () => {
    expect(invalidAttributeValueTitle('card', 'text', 'Hey')).toBe(
      invalidAttributeValueMessage('card', 'text', 'Hey'),
    );
  });
});

describe('the standard catalog and the default registry', () => {
  it('name the same components', async () => {
    const { defaultAnsiRegistry } = await import('./components/index.js');
    const { standardNoteCatalog } = await import('@markii/stdlib');
    const registered = Object.keys(defaultAnsiRegistry).sort();
    const catalogued = standardNoteCatalog()
      .map((entry) => entry.directiveName)
      .sort();
    expect(catalogued).toEqual(registered);
  });
});
