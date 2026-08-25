import { describe, expect, it } from 'vitest';
import {
  formatRelativeAgo,
  runMarkerLabel,
  runMarkerTitle,
} from './run-marker.js';

describe('formatRelativeAgo', () => {
  it('is "just now" under a minute, including negative (clock skew) deltas', () => {
    expect(formatRelativeAgo(0)).toBe('just now');
    expect(formatRelativeAgo(30_000)).toBe('just now');
    expect(formatRelativeAgo(-5000)).toBe('just now');
  });

  it('coarsens through minutes, hours, and days', () => {
    expect(formatRelativeAgo(2 * 60_000)).toBe('2m ago');
    expect(formatRelativeAgo(3 * 3_600_000)).toBe('3h ago');
    expect(formatRelativeAgo(5 * 86_400_000)).toBe('5d ago');
  });
});

describe('runMarkerLabel / runMarkerTitle', () => {
  const now = 1_000_000;

  it('labels a success without a title', () => {
    const trace = { ranAt: now - 60_000, ok: true };
    expect(runMarkerLabel(trace, now)).toBe('ran 1m ago');
    expect(runMarkerTitle(trace)).toBeUndefined();
  });

  it('labels a failure with a reason-bearing title', () => {
    const trace = { ranAt: now - 60_000, ok: false, reason: 'network denied' };
    expect(runMarkerLabel(trace, now)).toBe('run failed 1m ago');
    expect(runMarkerTitle(trace)).toBe('run failed: network denied');
  });

  it('falls back to a bare title when a failure has no reason', () => {
    const trace = { ranAt: now, ok: false };
    expect(runMarkerTitle(trace)).toBe('run failed');
  });
});
