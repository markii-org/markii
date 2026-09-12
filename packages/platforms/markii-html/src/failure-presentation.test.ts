import { describe, expect, it } from 'vitest';
import {
  dataStateClassName,
  failureKindClass,
  failurePhrase,
  failureTitle,
  invalidAttributeValueTitle,
  unsafeImageSrcTitle,
  NOTICE_ATTRIBUTE,
} from './failure-presentation.js';

describe('the silent-value-drop notice wording (#56, #60)', () => {
  it('NOTICE_ATTRIBUTE is the documented data attribute', () => {
    expect(NOTICE_ATTRIBUTE).toBe('data-mk-notice');
  });

  it('invalidAttributeValueTitle names the directive, value, and attribute', () => {
    expect(invalidAttributeValueTitle('card', 'text', 'Hey')).toBe(
      'card: "Hey" is not a valid text value (ignored)',
    );
  });

  it('unsafeImageSrcTitle names the directive', () => {
    expect(unsafeImageSrcTitle('figure')).toBe(
      'figure: image source was refused as unsafe and was not shown',
    );
  });

  it("matches @markii/react's wording word for word", () => {
    // Both engines are independent implementations of the same
    // presentation contract; this pins them to identical wording without
    // one importing the other.
    expect(invalidAttributeValueTitle('row', 'text', 'diagonal')).toBe(
      'row: "diagonal" is not a valid text value (ignored)',
    );
  });
});

describe('failurePhrase', () => {
  it('returns the short phrase for each taxonomy member', () => {
    expect(failurePhrase('script-error')).toBe('script error');
    expect(failurePhrase('capability-denied')).toBe('needs permission');
    expect(failurePhrase('tier-blocked')).toBe('requires manual run');
    expect(failurePhrase('limit')).toBe('limit exceeded');
  });

  it('returns undefined for an absent or out-of-taxonomy kind', () => {
    expect(failurePhrase(undefined)).toBeUndefined();
    // @ts-expect-error deliberately out of taxonomy
    expect(failurePhrase('__proto__')).toBeUndefined();
  });
});

describe('failureTitle', () => {
  it('combines the phrase and the error message', () => {
    expect(failureTitle('boom', 'script-error')).toBe('script error: boom');
  });

  it('falls back to the raw error with no recognized kind', () => {
    expect(failureTitle('boom', undefined)).toBe('boom');
  });

  it('is undefined with neither an error nor a kind', () => {
    expect(failureTitle(undefined, undefined)).toBeUndefined();
  });

  it('is just the phrase with a kind but no error message', () => {
    expect(failureTitle(undefined, 'limit')).toBe('limit exceeded');
  });
});

describe('failureKindClass', () => {
  it('builds the BEM-ish modifier class', () => {
    expect(failureKindClass('mk-stat', 'tier-blocked')).toBe(
      'mk-stat--tier-blocked',
    );
  });

  it('is undefined for an absent kind', () => {
    expect(failureKindClass('mk-stat', undefined)).toBeUndefined();
  });
});

describe('dataStateClassName', () => {
  it('is just the base with no status/kind', () => {
    expect(dataStateClassName('mk-stat', undefined, undefined)).toBe('mk-stat');
  });

  it('appends --stale for a stale status', () => {
    expect(dataStateClassName('mk-stat', 'stale', undefined)).toBe(
      'mk-stat mk-stat--stale',
    );
  });

  it('appends the failure-kind class for an error status', () => {
    expect(dataStateClassName('mk-stat', 'error', 'capability-denied')).toBe(
      'mk-stat mk-stat--capability-denied',
    );
  });

  it('keeps extra state modifiers adjacent to the base, before status/failure hooks', () => {
    expect(
      dataStateClassName('mk-chart', 'stale', 'limit', ['mk-chart--empty']),
    ).toBe('mk-chart mk-chart--empty mk-chart--stale mk-chart--limit');
  });
});
