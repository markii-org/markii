import { describe, expect, it } from 'vitest';
import {
  formMismatchMessage,
  invalidAttributeValueMessage,
  unsafeImageSrcMessage,
  unsafeVideoPosterMessage,
  unsafeVideoSrcMessage,
} from '@markii/stdlib';
import {
  formMismatchTitle,
  invalidAttributeValueTitle,
  unsafeImageSrcTitle,
  unsafeVideoPosterTitle,
  unsafeVideoSrcTitle,
} from './failure-presentation.js';

describe('wording shared with the note validator', () => {
  it('words a form mismatch the way the validator does', () => {
    expect(formMismatchTitle('callout')).toBe(formMismatchMessage('callout'));
  });

  it('words an unsafe image source the way the validator does', () => {
    expect(unsafeImageSrcTitle('figure')).toBe(unsafeImageSrcMessage('figure'));
  });

  it('words a refused video source and poster the way the validator does', () => {
    expect(unsafeVideoSrcTitle('video')).toBe(unsafeVideoSrcMessage('video'));
    expect(unsafeVideoPosterTitle('video')).toBe(
      unsafeVideoPosterMessage('video'),
    );
  });

  it('words an invalid attribute value the way the validator does', () => {
    expect(invalidAttributeValueTitle('card', 'text', 'Hey')).toBe(
      invalidAttributeValueMessage('card', 'text', 'Hey'),
    );
  });
});
