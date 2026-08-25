/**
 * Table-driven coverage for the address classifier (GitHub issue #10) that
 * `./net-pinning.ts` vets every resolved address against. This is the layer
 * an incomplete SSRF filter usually gets wrong: stopping at the three RFC
 * 1918 blocks and missing the cloud metadata address (169.254.169.254),
 * CGNAT (100.64/10), or one of the three IPv4-in-IPv6 wrapper shapes. Every
 * case here is checked against the REAL classifier, not a re-derivation of
 * its logic.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyIpAddress,
  describeScope,
  isRestrictedScope,
  type AddressScope,
} from './ip-address';

const ALL_SCOPES: AddressScope[] = [
  'public',
  'loopback',
  'private',
  'link-local',
  'unspecified',
  'multicast',
  'reserved',
];

describe('classifyIpAddress — IPv4', () => {
  const cases: [string, AddressScope][] = [
    // Public
    ['8.8.8.8', 'public'],
    ['1.1.1.1', 'public'],
    ['93.184.216.34', 'public'],
    // Loopback (127/8)
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback'],
    // RFC 1918 private
    ['10.0.0.1', 'private'],
    ['10.255.255.255', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.0.1', 'private'],
    ['192.168.255.255', 'private'],
    // Just outside the 172.16/12 block — real public space, not private.
    ['172.15.255.255', 'public'],
    ['172.32.0.0', 'public'],
    // CGNAT (RFC 6598, 100.64/10) — the classic incomplete-filter miss.
    ['100.64.0.1', 'private'],
    ['100.127.255.255', 'private'],
    ['100.63.255.255', 'public'],
    ['100.128.0.0', 'public'],
    // Link-local, including the cloud metadata address.
    ['169.254.0.1', 'link-local'],
    ['169.254.169.254', 'link-local'],
    ['169.254.255.255', 'link-local'],
    // Unspecified vs. other 0.0.0.0/8 addresses.
    ['0.0.0.0', 'unspecified'],
    ['0.0.0.1', 'reserved'],
    ['0.255.255.255', 'reserved'],
    // IETF protocol assignments / benchmarking / documentation.
    ['192.0.0.1', 'reserved'],
    ['198.18.0.1', 'reserved'],
    ['198.19.255.255', 'reserved'],
    ['192.0.2.1', 'reserved'],
    ['198.51.100.1', 'reserved'],
    ['203.0.113.1', 'reserved'],
    // Multicast and the reserved top block.
    ['224.0.0.1', 'multicast'],
    ['239.255.255.255', 'multicast'],
    ['240.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved'],
  ];

  it.each(cases)('classifies %s as %s', (address, scope) => {
    expect(classifyIpAddress(address)).toBe(scope);
  });

  it('rejects leading-zero octet forms rather than mis-parsing them as decimal', () => {
    expect(classifyIpAddress('010.0.0.1')).toBeUndefined();
    expect(classifyIpAddress('127.0.0.01')).toBeUndefined();
  });
});

describe('classifyIpAddress — IPv6', () => {
  const cases: [string, AddressScope][] = [
    ['::1', 'loopback'],
    ['0:0:0:0:0:0:0:1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['FE80::1', 'link-local'],
    ['fc00::1', 'private'],
    ['fd12:3456:789a::1', 'private'],
    ['ff02::1', 'multicast'],
    ['ff00::', 'multicast'],
    // Documentation range (2001:db8::/32).
    ['2001:db8::1', 'reserved'],
    // A genuine public IPv6 address (outside every special range).
    ['2606:4700:4700::1111', 'public'],
  ];

  it.each(cases)('classifies %s as %s', (address, scope) => {
    expect(classifyIpAddress(address)).toBe(scope);
  });

  it('honors a zone index (fe80::1%eth0) by classifying the address before the %', () => {
    expect(classifyIpAddress('fe80::1%eth0')).toBe('link-local');
  });

  it('accepts a bracketed literal, as it appears in a URL authority', () => {
    expect(classifyIpAddress('[::1]')).toBe('loopback');
    expect(classifyIpAddress('[2001:db8::1]')).toBe('reserved');
  });
});

describe('classifyIpAddress — IPv4-in-IPv6 wrapper shapes', () => {
  // Each of these is a documented SSRF bypass when a filter classifies the
  // WRAPPER instead of the IPv4 address it actually reaches.
  const cases: [string, AddressScope][] = [
    // IPv4-mapped (::ffff:a.b.c.d).
    ['::ffff:10.0.0.1', 'private'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:8.8.8.8', 'public'],
    ['::ffff:169.254.169.254', 'link-local'],
    // IPv4-compatible (::a.b.c.d), deprecated but still parseable.
    ['::10.0.0.1', 'private'],
    ['::8.8.8.8', 'public'],
    // 6to4 (2002::/16): the IPv4 address is embedded in the next 4 bytes.
    // 2002:7f00:0001:: -> 0x7f,0x00,0x00,0x01 -> 127.0.0.1 (loopback).
    ['2002:7f00:0001::', 'loopback'],
    // 2002:0a00:0001:: -> 10.0.0.1 (private).
    ['2002:0a00:0001::', 'private'],
    // 2002:0808:0808:: -> 8.8.8.8 (public).
    ['2002:0808:0808::', 'public'],
    // NAT64 well-known prefix (64:ff9b::/96).
    ['64:ff9b::8.8.8.8', 'public'],
    ['64:ff9b::169.254.169.254', 'link-local'],
    ['64:ff9b::10.0.0.1', 'private'],
  ];

  it.each(cases)(
    'classifies %s (wrapping an IPv4 payload) as %s',
    (address, scope) => {
      expect(classifyIpAddress(address)).toBe(scope);
    },
  );
});

describe('classifyIpAddress — non-IP inputs', () => {
  const notAnAddress = [
    'localhost',
    'example.com',
    'api.github.com',
    '',
    'not an ip',
    '999.999.999.999',
    '1.2.3',
    '1.2.3.4.5',
    'gggg::1',
  ];

  it.each(notAnAddress)('returns undefined for %j', (input) => {
    expect(classifyIpAddress(input)).toBeUndefined();
  });
});

describe('isRestrictedScope', () => {
  it('is false only for "public"', () => {
    expect(isRestrictedScope('public')).toBe(false);
  });

  it.each(ALL_SCOPES.filter((s) => s !== 'public'))(
    'is true for %s',
    (scope) => {
      expect(isRestrictedScope(scope)).toBe(true);
    },
  );
});

describe('describeScope', () => {
  it.each(ALL_SCOPES)('gives a non-empty description for %s', (scope) => {
    expect(typeof describeScope(scope)).toBe('string');
    expect(describeScope(scope).length).toBeGreaterThan(0);
  });

  it('gives every scope a distinct description', () => {
    const descriptions = new Set(ALL_SCOPES.map((s) => describeScope(s)));
    expect(descriptions.size).toBe(ALL_SCOPES.length);
  });
});
