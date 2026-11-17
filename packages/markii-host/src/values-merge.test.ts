import { describe, expect, it } from 'vitest';
import { mergeArrivingValue, mergeRunValue } from './values-merge';
import { mergePersistedValues } from './run/run-flow';
import type { StoredValue } from '@markii/runtime';

const fresh = (value: unknown): StoredValue => ({
  value,
  status: 'fresh',
  ranAt: 1,
});
const stale = (value: unknown): StoredValue => ({ value, status: 'stale' });

describe('mergeArrivingValue', () => {
  it('adds a name that was not in the store', () => {
    expect(mergeArrivingValue({}, 'a', fresh(1))).toEqual({ a: fresh(1) });
  });

  it('treats an absent store as empty', () => {
    expect(mergeArrivingValue(undefined, 'a', fresh(1))).toEqual({
      a: fresh(1),
    });
  });

  it('replaces ONLY the named value and leaves every other status alone', () => {
    // This is the behavior the whole feature rests on: one component goes
    // fresh mid-run while the rest of the note stays visibly stale.
    const before = { a: stale(1), b: stale(2), c: stale(3) };
    const after = mergeArrivingValue(before, 'b', fresh(20));

    expect(after).toEqual({ a: stale(1), b: fresh(20), c: stale(3) });
    expect(after.a).toBe(before.a);
    expect(after.c).toBe(before.c);
  });

  it('keeps a replaced name in its original position', () => {
    const after = mergeArrivingValue(
      { a: stale(1), b: stale(2), c: stale(3) },
      'b',
      fresh(20),
    );
    expect(Object.keys(after)).toEqual(['a', 'b', 'c']);
  });

  it('appends a genuinely new name after the existing ones', () => {
    const after = mergeArrivingValue({ a: stale(1) }, 'b', fresh(2));
    expect(Object.keys(after)).toEqual(['a', 'b']);
  });

  it('never mutates the store it was given', () => {
    const before = { a: stale(1) };
    const after = mergeArrivingValue(before, 'a', fresh(9));

    expect(before).toEqual({ a: stale(1) });
    expect(after).not.toBe(before);
  });

  it('stores a script legitimately named __proto__ as an own property, without touching the prototype', () => {
    const after = mergeArrivingValue({}, '__proto__', fresh('legal name'));

    expect(Object.hasOwn(after, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(after)).toBe(Object.prototype);
    expect(Object.entries(after)).toEqual([['__proto__', fresh('legal name')]]);
  });

  it('replaces a __proto__ entry that is already present', () => {
    const before = mergeArrivingValue({}, '__proto__', stale(1));
    const after = mergeArrivingValue(before, '__proto__', fresh(2));

    expect(Object.entries(after)).toEqual([['__proto__', fresh(2)]]);
  });

  it('carries an error value through unchanged — a failure is a result too', () => {
    const failure: StoredValue = {
      value: undefined,
      status: 'error',
      failureKind: 'capability-denied',
    };
    expect(mergeArrivingValue({ a: stale(1) }, 'a', failure)).toEqual({
      a: failure,
    });
  });
});

describe('mergeRunValue', () => {
  const error = (message: string): StoredValue => ({
    value: undefined,
    status: 'error',
    error: message,
  });

  it('replaces the named value with a non-error value and leaves the rest', () => {
    const before = { a: stale(1), b: stale(2) };
    const after = mergeRunValue(before, 'b', fresh(20));
    expect(after).toEqual({ a: stale(1), b: fresh(20) });
    expect(after.a).toBe(before.a);
    expect(Object.keys(after)).toEqual(['a', 'b']);
  });

  it('adds a name the store does not hold and accepts an absent store', () => {
    expect(mergeRunValue(undefined, 'a', fresh(1))).toEqual({ a: fresh(1) });
  });

  it('keeps a prior good value, marked stale, when an error arrives', () => {
    const after = mergeRunValue({ a: fresh(1) }, 'a', error('boom'));
    expect(after['a']).toEqual({ ...fresh(1), status: 'stale' });
  });

  it('keeps a prior stale value stale when an error arrives', () => {
    expect(mergeRunValue({ a: stale(1) }, 'a', error('boom'))['a']).toEqual(
      stale(1),
    );
  });

  it('stores the error when no prior good value exists', () => {
    expect(mergeRunValue({}, 'a', error('boom'))['a']).toEqual(error('boom'));
    expect(mergeRunValue({ a: error('old') }, 'a', error('new'))['a']).toEqual(
      error('new'),
    );
  });

  it('does not mutate the store it was given', () => {
    const before = { a: fresh(1) };
    mergeRunValue(before, 'a', error('boom'));
    expect(before).toEqual({ a: fresh(1) });
  });

  it('stores a script named __proto__ as an own property for a value and for an error', () => {
    const viaValue = mergeRunValue({}, '__proto__', fresh(1));
    expect(Object.hasOwn(viaValue, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(viaValue)).toBe(Object.prototype);
    const store = Object.fromEntries([['__proto__', fresh(1)]]);
    const viaError = mergeRunValue(store, '__proto__', error('boom'));
    expect(Object.hasOwn(viaError, '__proto__')).toBe(true);
    expect(
      (
        Object.getOwnPropertyDescriptor(viaError, '__proto__')
          ?.value as StoredValue
      ).status,
    ).toBe('stale');
  });

  it('agrees with mergePersistedValues for every arriving-value case', () => {
    const cases: Array<[StoredValue | undefined, StoredValue]> = [
      [undefined, fresh(1)],
      [fresh(1), fresh(2)],
      [fresh(1), error('x')],
      [stale(1), error('x')],
      [error('o'), error('x')],
      [undefined, error('x')],
    ];
    for (const [prior, arriving] of cases) {
      const previous: Record<string, StoredValue> =
        prior === undefined ? {} : { n: prior };
      expect(mergeRunValue(previous, 'n', arriving)['n']).toEqual(
        mergePersistedValues(previous, { n: arriving })['n'],
      );
    }
  });
});
