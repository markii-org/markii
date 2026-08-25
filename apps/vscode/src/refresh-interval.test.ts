import { describe, expect, it } from 'vitest';
import {
  parseRefreshIntervalSeconds,
  refreshIntervalValidationMessage,
} from './refresh-interval.js';

describe('parseRefreshIntervalSeconds', () => {
  it('parses a positive whole number', () => {
    expect(parseRefreshIntervalSeconds('30')).toBe(30);
    expect(parseRefreshIntervalSeconds('1')).toBe(1);
  });

  it('trims surrounding whitespace', () => {
    expect(parseRefreshIntervalSeconds('  12  ')).toBe(12);
  });

  it('rejects empty input', () => {
    expect(parseRefreshIntervalSeconds('')).toBeUndefined();
    expect(parseRefreshIntervalSeconds('   ')).toBeUndefined();
  });

  it('rejects zero and negative values', () => {
    expect(parseRefreshIntervalSeconds('0')).toBeUndefined();
    expect(parseRefreshIntervalSeconds('-5')).toBeUndefined();
  });

  it('rejects fractional values', () => {
    expect(parseRefreshIntervalSeconds('2.5')).toBeUndefined();
  });

  it('rejects non-numeric input', () => {
    expect(parseRefreshIntervalSeconds('abc')).toBeUndefined();
    expect(parseRefreshIntervalSeconds('30s')).toBeUndefined();
    expect(parseRefreshIntervalSeconds('1e3')).toBeUndefined();
  });
});

describe('refreshIntervalValidationMessage', () => {
  it('returns undefined for valid input', () => {
    expect(refreshIntervalValidationMessage('30')).toBeUndefined();
  });

  it('returns an error message for invalid input', () => {
    expect(refreshIntervalValidationMessage('')).toBeTypeOf('string');
    expect(refreshIntervalValidationMessage('0')).toBeTypeOf('string');
    expect(refreshIntervalValidationMessage('nope')).toBeTypeOf('string');
  });
});
