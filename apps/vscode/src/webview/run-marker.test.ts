import { describe, expect, it } from 'vitest';
import {
  formatRelativeAgo,
  runMarkerLabel,
  runMarkerTitle,
} from './run-marker.js';

describe('formatRelativeAgo', () => {
  it('says "just now" under a minute', () => {
    expect(formatRelativeAgo(0)).toBe('just now');
    expect(formatRelativeAgo(59_000)).toBe('just now');
  });

  it('reports whole minutes', () => {
    expect(formatRelativeAgo(60_000)).toBe('1m ago');
    expect(formatRelativeAgo(2 * 60_000 + 30_000)).toBe('2m ago');
  });

  it('reports whole hours once past 60 minutes', () => {
    expect(formatRelativeAgo(90 * 60_000)).toBe('1h ago');
  });

  it('reports whole days once past 24 hours', () => {
    expect(formatRelativeAgo(50 * 60 * 60_000)).toBe('2d ago');
  });

  it('clamps a negative delta to "just now"', () => {
    expect(formatRelativeAgo(-5000)).toBe('just now');
  });
});

describe('runMarkerLabel', () => {
  it('labels a successful run "ran <relative>"', () => {
    expect(runMarkerLabel({ ranAt: 0, ok: true }, 120_000)).toBe('ran 2m ago');
  });

  it('labels a failed run "run failed <relative>"', () => {
    expect(runMarkerLabel({ ranAt: 0, ok: false, reason: 'x' }, 120_000)).toBe(
      'run failed 2m ago',
    );
  });
});

describe('runMarkerTitle', () => {
  it('is undefined for a successful run', () => {
    expect(runMarkerTitle({ ranAt: 0, ok: true })).toBeUndefined();
  });

  it('carries the reason for a failed run', () => {
    expect(
      runMarkerTitle({ ranAt: 0, ok: false, reason: 'network timeout' }),
    ).toBe('run failed: network timeout');
  });

  it('degrades to a plain phrase when no reason was recorded', () => {
    expect(runMarkerTitle({ ranAt: 0, ok: false })).toBe('run failed');
  });
});
