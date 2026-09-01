import { describe, expect, it } from 'vitest';
import { mergeArrivingValue } from './values-merge';
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
