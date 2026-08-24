/**
 * Policy-matrix coverage for `pinHostAddress`/`pinnedLookup` (GitHub issue
 * #10) — pure unit tests against an INJECTED resolver, so every branch is
 * driven without touching real DNS or a socket. The live end-to-end proof
 * (a genuine rebound name refused before a real server sees any traffic)
 * lives in `net-pinning.probe.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  pinHostAddress,
  pinnedLookup,
  type HostLookup,
  type PinPolicy,
  type ResolvedAddress,
} from './net-pinning';

const RESTRICTIVE: PinPolicy = { allowRestrictedAddresses: false };
const PERMISSIVE: PinPolicy = { allowRestrictedAddresses: true };

function lookupReturning(addresses: ResolvedAddress[]): HostLookup {
  return vi.fn(async () => addresses);
}

describe('pinHostAddress — literal grants are honored at any scope', () => {
  const literalCases: [string, string, 4 | 6][] = [
    ['127.0.0.1', 'loopback', 4],
    ['10.0.0.5', 'private', 4],
    ['169.254.169.254', 'link-local', 4],
    ['8.8.8.8', 'public', 4],
    ['224.0.0.1', 'multicast', 4],
    ['240.0.0.1', 'reserved', 4],
    ['0.0.0.0', 'unspecified', 4],
    ['::1', 'loopback', 6],
    ['fc00::1', 'private', 6],
    ['[::1]', 'loopback', 6],
    ['[fe80::1]', 'link-local', 6],
  ];

  it.each(literalCases)(
    'grant %s (%s) is honored under the restrictive policy, with no resolution at all',
    async (hostname, scope, family) => {
      const lookup = lookupReturning([]);
      const result = await pinHostAddress(hostname, RESTRICTIVE, lookup);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pinned.scope).toBe(scope);
      expect(result.pinned.family).toBe(family);
      expect(result.pinned.literal).toBe(true);
      // The whole point of a literal grant: there is nothing to resolve.
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it('a bracketed IPv6 literal is pinned without its brackets', async () => {
    const result = await pinHostAddress(
      '[::1]',
      RESTRICTIVE,
      lookupReturning([]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pinned.address).toBe('::1');
  });
});

describe('pinHostAddress — localhost and *.localhost', () => {
  const names = ['localhost', 'LOCALHOST', 'sub.localhost', 'a.b.localhost'];

  it.each(names)('%s pins to loopback with no resolution', async (hostname) => {
    const lookup = lookupReturning([]);
    const result = await pinHostAddress(hostname, RESTRICTIVE, lookup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pinned.address).toBe('127.0.0.1');
    expect(result.pinned.scope).toBe('loopback');
    expect(result.pinned.literal).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not treat "notlocalhost" or "localhost.evil.com" as the special name', async () => {
    const lookup = lookupReturning([{ address: '93.184.216.34', family: 4 }]);
    const notLocalhost = await pinHostAddress(
      'localhost.evil.com',
      RESTRICTIVE,
      lookup,
    );
    expect(notLocalhost.ok).toBe(true);
    expect(lookup).toHaveBeenCalledWith('localhost.evil.com');
  });
});

describe('pinHostAddress — a named host resolving to a public address', () => {
  it('is allowed under the restrictive (default) policy', async () => {
    const lookup = lookupReturning([{ address: '93.184.216.34', family: 4 }]);
    const result = await pinHostAddress('api.example.com', RESTRICTIVE, lookup);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pinned.address).toBe('93.184.216.34');
    expect(result.pinned.family).toBe(4);
    expect(result.pinned.scope).toBe('public');
    expect(result.pinned.literal).toBe(false);
    expect(lookup).toHaveBeenCalledWith('api.example.com');
  });

  it('an IPv6 public answer is pinned with family 6', async () => {
    const lookup = lookupReturning([
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    const result = await pinHostAddress('api.example.com', RESTRICTIVE, lookup);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pinned.family).toBe(6);
  });
});

describe('pinHostAddress — a named host resolving to a restricted address is refused', () => {
  const restrictedAnswers: [string, ResolvedAddress][] = [
    ['loopback', { address: '127.0.0.1', family: 4 }],
    ['private (RFC 1918)', { address: '10.0.0.5', family: 4 }],
    ['private (CGNAT)', { address: '100.64.0.1', family: 4 }],
    ['link-local', { address: '169.254.1.1', family: 4 }],
    ['the cloud metadata address', { address: '169.254.169.254', family: 4 }],
    ['IPv6 unique-local', { address: 'fc00::1', family: 6 }],
    ['IPv6 link-local', { address: 'fe80::1', family: 6 }],
  ];

  it.each(restrictedAnswers)(
    'a public-looking name resolving to a %s address is refused, not pinned',
    async (_label, address) => {
      const lookup = lookupReturning([address]);
      const result = await pinHostAddress(
        'api.example.com',
        RESTRICTIVE,
        lookup,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain('api.example.com');
    },
  );
});

describe('pinHostAddress — a mixed public+private answer is refused OUTRIGHT', () => {
  it('public first, private second: still refused, not filtered down to the public address', async () => {
    const lookup = lookupReturning([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    const result = await pinHostAddress('api.example.com', RESTRICTIVE, lookup);
    expect(result.ok).toBe(false);
  });

  it('private first, public second: order does not matter', async () => {
    const lookup = lookupReturning([
      { address: '10.0.0.5', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);
    const result = await pinHostAddress('api.example.com', RESTRICTIVE, lookup);
    expect(result.ok).toBe(false);
  });
});

describe('pinHostAddress — allowRestrictedAddresses opt-in', () => {
  it('flips a named host resolving to a private address to allowed', async () => {
    const lookup = lookupReturning([{ address: '10.0.0.5', family: 4 }]);
    const result = await pinHostAddress(
      'internal.example.com',
      PERMISSIVE,
      lookup,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pinned.address).toBe('10.0.0.5');
    expect(result.pinned.scope).toBe('private');
    expect(result.pinned.literal).toBe(false);
  });

  it('flips a named host resolving to loopback to allowed', async () => {
    const lookup = lookupReturning([{ address: '127.0.0.1', family: 4 }]);
    const result = await pinHostAddress(
      'internal.example.com',
      PERMISSIVE,
      lookup,
    );
    expect(result.ok).toBe(true);
  });

  it('flips a named host resolving to link-local to allowed', async () => {
    const lookup = lookupReturning([{ address: '169.254.1.1', family: 4 }]);
    const result = await pinHostAddress(
      'internal.example.com',
      PERMISSIVE,
      lookup,
    );
    expect(result.ok).toBe(true);
  });

  it('a mixed answer is allowed under the opt-in, pinned to the first address returned', async () => {
    const lookup = lookupReturning([
      { address: '10.0.0.5', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);
    const result = await pinHostAddress(
      'internal.example.com',
      PERMISSIVE,
      lookup,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pinned.address).toBe('10.0.0.5');
  });
});

describe('pinHostAddress — resolver failure modes', () => {
  it('a resolver that throws is a clean denial, not a thrown error', async () => {
    const lookup: HostLookup = async () => {
      throw new Error('ENOTFOUND (simulated)');
    };
    const result = await pinHostAddress('api.example.com', RESTRICTIVE, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('api.example.com');
      // The resolver's own message is deliberately not surfaced (varies by
      // platform, says nothing a note's author can act on).
      expect(result.reason).not.toContain('ENOTFOUND');
    }
  });

  it('an empty answer is a clean denial', async () => {
    const result = await pinHostAddress(
      'api.example.com',
      RESTRICTIVE,
      lookupReturning([]),
    );
    expect(result.ok).toBe(false);
  });

  it('an answer containing something that is not a parseable IP is a clean denial', async () => {
    const lookup = lookupReturning([{ address: 'not-an-ip', family: 4 }]);
    const result = await pinHostAddress('api.example.com', RESTRICTIVE, lookup);
    expect(result.ok).toBe(false);
  });
});

describe('pinnedLookup', () => {
  const pinned = {
    address: '203.0.113.9',
    family: 4 as const,
    scope: 'public' as const,
    literal: false,
  };

  it("answers the {all: true} array form Node's own connect path uses", () => {
    const fn = pinnedLookup(pinned);
    const callback = vi.fn();
    fn('ignored.example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '203.0.113.9', family: 4 },
    ]);
  });

  it('answers the single-address form for a caller passing {all: false} (or omitting it)', () => {
    const fn = pinnedLookup(pinned);
    const callback = vi.fn();
    fn('ignored.example.com', { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, '203.0.113.9', 4);
  });

  it('defaults to the single-address form when `all` is omitted entirely', () => {
    const fn = pinnedLookup(pinned);
    const callback = vi.fn();
    fn('ignored.example.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '203.0.113.9', 4);
  });

  it('never calls back with an error', () => {
    const fn = pinnedLookup(pinned);
    const callback = vi.fn();
    fn('ignored.example.com', { all: true }, callback);
    expect(callback.mock.calls[0]?.[0]).toBeNull();
  });
});
