import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatValue } from './value-format.js';

/**
 * `formatValue` is the ONE shared formatter `@markii/react` and
 * `@markii/html` both route through (docs/format.md's `format`/`decimals`
 * attributes) — these tests pin the exact output for every format, every
 * `decimals` edge, and the never-throws contract for hostile input. Locale
 * is fixed inside `value-format.ts` (`'en-US'`), so these assertions are
 * environment-independent except for `date`/`relative`, which are inherently
 * timezone-sensitive ("local date" is the point) — this file sets `TZ=UTC`
 * for the whole process so the two date-shaped tests are still
 * deterministic in CI.
 */

let originalTz: string | undefined;
beforeAll(() => {
  originalTz = process.env.TZ;
  process.env.TZ = 'UTC';
});
afterAll(() => {
  process.env.TZ = originalTz;
});

describe('formatValue — plain (default)', () => {
  it('returns a string as-is', () => {
    expect(formatValue('hello')).toBe('hello');
  });

  it('stringifies numbers and booleans', () => {
    expect(formatValue(42)).toBe('42');
    expect(formatValue(true)).toBe('true');
  });

  it('renders null/undefined as the empty string', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue(undefined)).toBe('');
  });

  it('JSON-stringifies plain objects/arrays', () => {
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue([1, 2])).toBe('[1,2]');
  });

  it('an unrecognized format name behaves as plain', () => {
    expect(formatValue(2301234, 'not-a-real-format')).toBe('2301234');
    expect(formatValue('hello', 'bogus')).toBe('hello');
  });

  it('explicit format="plain" matches the default', () => {
    expect(formatValue(42, 'plain')).toBe(formatValue(42));
  });
});

describe('formatValue — number', () => {
  it('groups thousands with the default decimals', () => {
    expect(formatValue(2301234, 'number')).toBe('2,301,234');
  });

  it('applies decimals at both ends of the 0..6 range', () => {
    expect(formatValue(1234.5678, 'number', '0')).toBe('1,235');
    expect(formatValue(1234.5, 'number', '6')).toBe('1,234.500000');
  });

  it('ignores out-of-range or non-integer decimals, falling back to the format default', () => {
    expect(formatValue(1234.5678, 'number', '7')).toBe('1,234.568');
    expect(formatValue(1234.5678, 'number', '-1')).toBe('1,234.568');
    expect(formatValue(1234.5678, 'number', '2.5')).toBe('1,234.568');
    expect(formatValue(1234.5678, 'number', 'abc')).toBe('1,234.568');
  });

  it('accepts a numeric string as input', () => {
    expect(formatValue('2301234', 'number')).toBe('2,301,234');
  });

  it('non-numeric input renders the plain stringified value', () => {
    expect(formatValue('not a number', 'number')).toBe('not a number');
    expect(formatValue({ a: 1 }, 'number')).toBe('{"a":1}');
    expect(formatValue(null, 'number')).toBe('');
    expect(formatValue(true, 'number')).toBe('true');
  });

  it('normalizes negative zero to 0', () => {
    expect(formatValue(-0, 'number')).toBe('0');
  });
});

describe('formatValue — compact', () => {
  it("renders millions and thousands per docs/format.md's examples", () => {
    expect(formatValue(2300000, 'compact')).toBe('2.3M');
    expect(formatValue(12400, 'compact')).toBe('12.4k');
  });

  it('applies decimals', () => {
    expect(formatValue(12400, 'compact', '0')).toBe('12k');
    expect(formatValue(2345000, 'compact', '3')).toBe('2.345M');
  });

  it('non-numeric input renders the plain stringified value', () => {
    expect(formatValue('nope', 'compact')).toBe('nope');
  });
});

describe('formatValue — percent', () => {
  it('renders the documented example', () => {
    expect(formatValue(0.123, 'percent')).toBe('12.3%');
  });

  it('applies decimals at both ends of the range', () => {
    expect(formatValue(0.12345, 'percent', '0')).toBe('12%');
    expect(formatValue(0.12345, 'percent', '6')).toBe('12.345000%');
  });

  it('non-numeric input renders the plain stringified value', () => {
    expect(formatValue('nope', 'percent')).toBe('nope');
  });
});

describe('formatValue — date', () => {
  it('renders an ISO 8601 string as a local date', () => {
    expect(formatValue('2024-01-15T00:00:00Z', 'date')).toBe('Jan 15, 2024');
  });

  it('renders epoch milliseconds (number or numeric string) the same way', () => {
    const epoch = Date.parse('2024-01-15T00:00:00Z');
    expect(formatValue(epoch, 'date')).toBe('Jan 15, 2024');
    expect(formatValue(String(epoch), 'date')).toBe('Jan 15, 2024');
  });

  it('non-date input renders the plain stringified value', () => {
    expect(formatValue('not a date', 'date')).toBe('not a date');
    expect(formatValue(Infinity, 'date')).toBe('Infinity');
    expect(formatValue(NaN, 'date')).toBe('NaN');
  });
});

describe('formatValue — relative', () => {
  const now = Date.parse('2024-01-15T12:00:00Z');

  it('renders the documented "3 hours ago" example, against a fixed render time', () => {
    const threeHoursAgo = now - 3 * 60 * 60 * 1000;
    expect(formatValue(threeHoursAgo, 'relative', undefined, now)).toBe(
      '3 hours ago',
    );
  });

  it('renders a future instant as "in N units"', () => {
    const inTwoDays = now + 2 * 24 * 60 * 60 * 1000;
    expect(formatValue(inTwoDays, 'relative', undefined, now)).toBe(
      'in 2 days',
    );
  });

  it('accepts an ISO string', () => {
    expect(
      formatValue('2024-01-15T11:00:00Z', 'relative', undefined, now),
    ).toBe('1 hour ago');
  });

  it('non-date input renders the plain stringified value', () => {
    expect(formatValue('not a date', 'relative', undefined, now)).toBe(
      'not a date',
    );
  });
});

describe('formatValue — never throws on hostile input', () => {
  it('a throwing getter', () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'value', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    for (const format of [
      'plain',
      'number',
      'compact',
      'percent',
      'date',
      'relative',
    ]) {
      expect(() => formatValue(hostile, format)).not.toThrow();
    }
  });

  it('a revoked Proxy', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    for (const format of [
      'plain',
      'number',
      'compact',
      'percent',
      'date',
      'relative',
    ]) {
      expect(() => formatValue(proxy, format)).not.toThrow();
    }
  });

  it('a Symbol', () => {
    const symbol = Symbol('x');
    for (const format of [
      'plain',
      'number',
      'compact',
      'percent',
      'date',
      'relative',
    ]) {
      expect(() => formatValue(symbol, format)).not.toThrow();
    }
  });

  it('NaN, Infinity, -Infinity, huge numbers, negative zero', () => {
    for (const value of [NaN, Infinity, -Infinity, 1e308, -0]) {
      for (const format of [
        'plain',
        'number',
        'compact',
        'percent',
        'date',
        'relative',
      ]) {
        expect(() => formatValue(value, format)).not.toThrow();
      }
    }
  });

  it('a cyclic object (JSON.stringify would throw)', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const format of [
      'plain',
      'number',
      'compact',
      'percent',
      'date',
      'relative',
    ]) {
      expect(() => formatValue(cyclic, format)).not.toThrow();
    }
  });

  it('an Object.create(null) with no toString', () => {
    const bare = Object.create(null) as unknown;
    for (const format of [
      'plain',
      'number',
      'compact',
      'percent',
      'date',
      'relative',
    ]) {
      expect(() => formatValue(bare, format)).not.toThrow();
    }
  });
});
