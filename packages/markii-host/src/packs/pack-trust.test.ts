import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PACK_TRUST_LIST,
  MAX_TRUSTED_PACKS,
  isPackTrusted,
  normalizePackTrustList,
  trustPack,
  untrustPack,
} from './pack-trust.js';

describe('normalizePackTrustList', () => {
  it('defaults to an empty list for non-object input', () => {
    expect(normalizePackTrustList(undefined)).toEqual(DEFAULT_PACK_TRUST_LIST);
    expect(normalizePackTrustList(null)).toEqual(DEFAULT_PACK_TRUST_LIST);
    expect(normalizePackTrustList('nope')).toEqual(DEFAULT_PACK_TRUST_LIST);
    expect(normalizePackTrustList(42)).toEqual(DEFAULT_PACK_TRUST_LIST);
  });

  it('defaults to an empty list when entries is missing or not an array', () => {
    expect(normalizePackTrustList({})).toEqual(DEFAULT_PACK_TRUST_LIST);
    expect(normalizePackTrustList({ entries: 'nope' })).toEqual(
      DEFAULT_PACK_TRUST_LIST,
    );
  });

  it('keeps a well-formed entry, with and without a version', () => {
    const result = normalizePackTrustList({
      entries: [{ namespace: 'read', version: '1.0.0' }, { namespace: 'dash' }],
    });
    expect(result.entries).toEqual([
      { namespace: 'read', version: '1.0.0' },
      { namespace: 'dash' },
    ]);
  });

  it('drops a non-string or empty namespace rather than failing the whole read', () => {
    const result = normalizePackTrustList({
      entries: [
        { namespace: 42 },
        { namespace: '   ' },
        {},
        null,
        'nope',
        { namespace: 'ok' },
      ],
    });
    expect(result.entries).toEqual([{ namespace: 'ok' }]);
  });

  it('drops a non-string version but keeps the entry', () => {
    const result = normalizePackTrustList({
      entries: [{ namespace: 'read', version: 7 }],
    });
    expect(result.entries).toEqual([{ namespace: 'read' }]);
  });

  it('trims whitespace and deduplicates by namespace, first occurrence wins', () => {
    const result = normalizePackTrustList({
      entries: [
        { namespace: '  read  ', version: '1.0.0' },
        { namespace: 'read', version: '2.0.0' },
      ],
    });
    expect(result.entries).toEqual([{ namespace: 'read', version: '1.0.0' }]);
  });

  it('bounds the list at MAX_TRUSTED_PACKS', () => {
    const entries = Array.from({ length: MAX_TRUSTED_PACKS + 20 }, (_, i) => ({
      namespace: `pack${String(i)}`,
    }));
    const result = normalizePackTrustList({ entries });
    expect(result.entries).toHaveLength(MAX_TRUSTED_PACKS);
  });
});

describe('isPackTrusted', () => {
  it('is true only for a namespace present in the list', () => {
    const list = normalizePackTrustList({ entries: [{ namespace: 'read' }] });
    expect(isPackTrusted(list, 'read')).toBe(true);
    expect(isPackTrusted(list, 'dash')).toBe(false);
  });
});

describe('trustPack', () => {
  it('adds a new namespace with its version', () => {
    const next = trustPack(DEFAULT_PACK_TRUST_LIST, 'read', '1.0.0');
    expect(next.entries).toEqual([{ namespace: 'read', version: '1.0.0' }]);
  });

  it('adds a new namespace with no version', () => {
    const next = trustPack(DEFAULT_PACK_TRUST_LIST, 'read');
    expect(next.entries).toEqual([{ namespace: 'read' }]);
  });

  it('replaces an existing entry’s version', () => {
    const first = trustPack(DEFAULT_PACK_TRUST_LIST, 'read', '1.0.0');
    const second = trustPack(first, 'read', '2.0.0');
    expect(second.entries).toEqual([{ namespace: 'read', version: '2.0.0' }]);
  });

  it('returns the same list reference when nothing would change', () => {
    const first = trustPack(DEFAULT_PACK_TRUST_LIST, 'read', '1.0.0');
    const second = trustPack(first, 'read', '1.0.0');
    expect(second).toBe(first);
  });

  it('ignores an empty or whitespace-only namespace', () => {
    expect(trustPack(DEFAULT_PACK_TRUST_LIST, '   ')).toBe(
      DEFAULT_PACK_TRUST_LIST,
    );
  });
});

describe('untrustPack', () => {
  it('removes an existing entry', () => {
    const list = trustPack(DEFAULT_PACK_TRUST_LIST, 'read', '1.0.0');
    expect(untrustPack(list, 'read').entries).toEqual([]);
  });

  it('returns the same list reference when the namespace was not present', () => {
    expect(untrustPack(DEFAULT_PACK_TRUST_LIST, 'read')).toBe(
      DEFAULT_PACK_TRUST_LIST,
    );
  });
});
