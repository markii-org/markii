import { describe, expect, it } from 'vitest';
import { stringifyStoredValue } from './value-format.js';

describe('stringifyStoredValue', () => {
  it('returns a string value as-is', () => {
    expect(stringifyStoredValue('hello')).toBe('hello');
  });

  it('stringifies numbers and booleans', () => {
    expect(stringifyStoredValue(42)).toBe('42');
    expect(stringifyStoredValue(true)).toBe('true');
  });

  it('renders null/undefined as the empty string', () => {
    expect(stringifyStoredValue(null)).toBe('');
    expect(stringifyStoredValue(undefined)).toBe('');
  });

  it('renders an object/array as JSON', () => {
    expect(stringifyStoredValue({ a: 1 })).toBe('{"a":1}');
    expect(stringifyStoredValue([1, 2])).toBe('[1,2]');
  });

  it('degrades to the empty string for a value JSON.stringify returns undefined for', () => {
    expect(stringifyStoredValue(() => 1)).toBe('');
  });

  it('never throws for a value whose JSON.stringify and String() both throw', () => {
    const hostile = {
      toJSON() {
        throw new Error('boom');
      },
      toString() {
        throw new Error('boom');
      },
      [Symbol.toPrimitive]() {
        throw new Error('boom');
      },
    };
    expect(() => stringifyStoredValue(hostile)).not.toThrow();
    expect(stringifyStoredValue(hostile)).toBe('');
  });

  it('never throws for a cyclic object (JSON.stringify throws, falls back to String)', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stringifyStoredValue(cyclic)).not.toThrow();
    expect(stringifyStoredValue(cyclic)).toBe('[object Object]');
  });
});
