import { describe, expect, it } from 'vitest';
import {
  FAILURE_KINDS,
  normalizeFailureKind,
  type FailureKind,
} from './failure';

describe('normalizeFailureKind', () => {
  it.each(FAILURE_KINDS)('passes a genuine %s through unchanged', (kind) => {
    expect(normalizeFailureKind(kind)).toBe(kind);
  });

  it('FAILURE_KINDS lists exactly the four union members, no more, no fewer', () => {
    expect(FAILURE_KINDS).toEqual([
      'script-error',
      'capability-denied',
      'tier-blocked',
      'limit',
    ]);
  });

  it.each([
    ['a plain string not in the union', 'capability'],
    ['an empty string', ''],
    ['a prototype-pollution attempt', '__proto__'],
    ['another prototype-pollution attempt', 'constructor'],
    ['a case-mismatched real kind', 'Script-Error'],
    ['a real kind with trailing whitespace', 'limit '],
  ] as const)('normalizes %s to script-error', (_label, input) => {
    expect(normalizeFailureKind(input)).toBe('script-error');
  });

  it('normalizes undefined to script-error', () => {
    expect(normalizeFailureKind(undefined)).toBe('script-error');
  });

  it('normalizes null to script-error', () => {
    expect(normalizeFailureKind(null)).toBe('script-error');
  });

  it('normalizes a number to script-error', () => {
    expect(normalizeFailureKind(123)).toBe('script-error');
  });

  it('normalizes a boolean to script-error', () => {
    expect(normalizeFailureKind(true)).toBe('script-error');
  });

  it('normalizes an object to script-error, without throwing even for a hostile shape', () => {
    expect(normalizeFailureKind({ kind: 'limit' })).toBe('script-error');
    expect(normalizeFailureKind({ toString: () => 'limit' })).toBe(
      'script-error',
    );
  });

  it('normalizes an array to script-error', () => {
    expect(normalizeFailureKind(['limit'])).toBe('script-error');
  });

  it('never throws for any input shape', () => {
    const hostileInputs: unknown[] = [
      undefined,
      null,
      123,
      true,
      {},
      [],
      Symbol('x'),
      () => 'limit',
      new Error('limit'),
    ];
    for (const input of hostileInputs) {
      expect(() => normalizeFailureKind(input)).not.toThrow();
    }
  });

  it('the return type is always assignable to FailureKind (compile-time sanity)', () => {
    const kind: FailureKind = normalizeFailureKind('tier-blocked');
    expect(kind).toBe('tier-blocked');
  });
});
