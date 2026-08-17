import { describe, expect, it } from 'vitest';
import {
  isHostToWebviewMessage,
  isNewerRevision,
  isWebviewToHostMessage,
} from './protocol';

describe('isHostToWebviewMessage', () => {
  it('accepts a well-formed update message', () => {
    expect(
      isHostToWebviewMessage({ type: 'update', revision: 1, text: 'hi' }),
    ).toBe(true);
  });

  it('accepts revision 0', () => {
    expect(
      isHostToWebviewMessage({ type: 'update', revision: 0, text: '' }),
    ).toBe(true);
  });

  it('rejects null', () => {
    expect(isHostToWebviewMessage(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isHostToWebviewMessage(undefined)).toBe(false);
  });

  it('rejects an array', () => {
    expect(isHostToWebviewMessage(['update', 1, 'hi'])).toBe(false);
  });

  it('rejects a bare string', () => {
    expect(isHostToWebviewMessage('update')).toBe(false);
  });

  it('rejects a number', () => {
    expect(isHostToWebviewMessage(42)).toBe(false);
  });

  it('rejects a missing type field', () => {
    expect(isHostToWebviewMessage({ revision: 1, text: 'hi' })).toBe(false);
  });

  it('rejects the wrong type value', () => {
    expect(
      isHostToWebviewMessage({ type: 'ready', revision: 1, text: 'hi' }),
    ).toBe(false);
  });

  it('rejects a missing revision field', () => {
    expect(isHostToWebviewMessage({ type: 'update', text: 'hi' })).toBe(false);
  });

  it('rejects a missing text field', () => {
    expect(isHostToWebviewMessage({ type: 'update', revision: 1 })).toBe(false);
  });

  it('rejects text that is not a string', () => {
    expect(
      isHostToWebviewMessage({ type: 'update', revision: 1, text: 42 }),
    ).toBe(false);
  });

  it('rejects a NaN revision', () => {
    expect(
      isHostToWebviewMessage({ type: 'update', revision: NaN, text: 'hi' }),
    ).toBe(false);
  });

  it('rejects an Infinity revision', () => {
    expect(
      isHostToWebviewMessage({
        type: 'update',
        revision: Infinity,
        text: 'hi',
      }),
    ).toBe(false);
  });

  it('rejects a negative revision', () => {
    expect(
      isHostToWebviewMessage({ type: 'update', revision: -1, text: 'hi' }),
    ).toBe(false);
  });

  it('rejects a non-integer revision', () => {
    expect(
      isHostToWebviewMessage({ type: 'update', revision: 1.5, text: 'hi' }),
    ).toBe(false);
  });

  it('rejects a revision that is a numeric string', () => {
    expect(
      isHostToWebviewMessage({ type: 'update', revision: '1', text: 'hi' }),
    ).toBe(false);
  });

  it('rejects an object that only inherits `type` from its prototype', () => {
    const proto = { type: 'update' };
    const hostile: unknown = Object.assign(Object.create(proto), {
      revision: 1,
      text: 'hi',
    });
    expect(isHostToWebviewMessage(hostile)).toBe(false);
  });
});

describe('isWebviewToHostMessage', () => {
  it('accepts a well-formed ready message', () => {
    expect(isWebviewToHostMessage({ type: 'ready' })).toBe(true);
  });

  it('rejects null', () => {
    expect(isWebviewToHostMessage(null)).toBe(false);
  });

  it('rejects an array', () => {
    expect(isWebviewToHostMessage(['ready'])).toBe(false);
  });

  it('rejects a bare string', () => {
    expect(isWebviewToHostMessage('ready')).toBe(false);
  });

  it('rejects a missing type field', () => {
    expect(isWebviewToHostMessage({})).toBe(false);
  });

  it('rejects the wrong type value', () => {
    expect(isWebviewToHostMessage({ type: 'update' })).toBe(false);
  });

  it('rejects an object that only inherits `type` from its prototype', () => {
    const proto = { type: 'ready' };
    const hostile: unknown = Object.create(proto);
    expect(isWebviewToHostMessage(hostile)).toBe(false);
  });
});

describe('isNewerRevision', () => {
  it('is true when incoming is strictly greater than lastSeen', () => {
    expect(isNewerRevision(1, 2)).toBe(true);
  });

  it('is false when incoming equals lastSeen', () => {
    expect(isNewerRevision(2, 2)).toBe(false);
  });

  it('is false when incoming is less than lastSeen', () => {
    expect(isNewerRevision(3, 2)).toBe(false);
  });

  it('is true from the initial lastSeen of 0', () => {
    expect(isNewerRevision(0, 1)).toBe(true);
  });

  it('is false when lastSeen is NaN', () => {
    expect(isNewerRevision(NaN, 2)).toBe(false);
  });

  it('is false when incoming is NaN', () => {
    expect(isNewerRevision(1, NaN)).toBe(false);
  });

  it('is false when incoming is Infinity', () => {
    expect(isNewerRevision(1, Infinity)).toBe(false);
  });

  it('is false when either value is a non-integer', () => {
    expect(isNewerRevision(1, 1.5)).toBe(false);
    expect(isNewerRevision(1.5, 2)).toBe(false);
  });
});
