import { describe, expect, it } from 'vitest';
import { firstSentence } from './first-sentence.js';

describe('firstSentence', () => {
  it('returns the string unchanged when it has no sentence boundary', () => {
    expect(firstSentence('A titled panel.')).toBe('A titled panel.');
  });

  it('truncates at the first ". " followed by an uppercase letter', () => {
    expect(firstSentence('First one. Second one.')).toBe('First one.');
  });

  it('does not truncate at an abbreviation like "e.g." not followed by a capital', () => {
    expect(firstSentence('A panel, e.g. `:::callout{}`.')).toBe(
      'A panel, e.g. `:::callout{}`.',
    );
  });

  it('truncates after an abbreviation clause when a real sentence break follows', () => {
    expect(
      firstSentence('A panel, e.g. `:::callout{}`. Takes no attributes.'),
    ).toBe('A panel, e.g. `:::callout{}`.');
  });

  it('returns the empty string unchanged', () => {
    expect(firstSentence('')).toBe('');
  });
});
