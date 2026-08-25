/**
 * Address classification for the run path's network jail (GitHub issue #10).
 *
 * A network grant is a hostname string, so the host the user consented to and
 * the address the request actually reaches are two different things. This
 * module answers the second half: given an address, is it somewhere a note's
 * script has any business reaching?
 *
 * Pure and dependency-free apart from `node:net`'s address validators, so it
 * is exhaustively testable without a socket, a resolver, or a worker.
 */
import { isIPv4, isIPv6 } from 'node:net';

/**
 * Where an address lives. Everything that is not `'public'` is somewhere a
 * script reaching it would be a surprise to the person who granted a
 * hostname: their own machine, their own LAN, or a range that is not
 * globally routable at all.
 */
export type AddressScope =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'unspecified'
  | 'multicast'
  | 'reserved';

/** Every scope except `'public'`: not reachable by default from a note's script. */
export function isRestrictedScope(scope: AddressScope): boolean {
  return scope !== 'public';
}

/** Human wording for a denial or a grant prompt. Kept here so one vocabulary describes a scope everywhere. */
export function describeScope(scope: AddressScope): string {
  switch (scope) {
    case 'public':
      return 'a public address';
    case 'loopback':
      return 'an address on this machine';
    case 'private':
      return 'an address on this private network';
    case 'link-local':
      return 'a link-local address';
    case 'unspecified':
      return 'the unspecified address';
    case 'multicast':
      return 'a multicast address';
    case 'reserved':
      return 'a reserved address';
  }
}

/**
 * Classifies `address`, or returns `undefined` when it is not an IP literal
 * at all (a hostname, or anything malformed). `node:net`'s validators decide
 * what counts as an IP, so this never disagrees with what the runtime itself
 * would accept: notably, they reject the leading-zero octet forms
 * (`010.0.0.1`) that some SSRF filters mis-parse as decimal.
 */
export function classifyIpAddress(address: string): AddressScope | undefined {
  const trimmed = address.trim();
  // A bracketed literal is how an IPv6 address appears in a URL authority;
  // `URL.hostname` hands it back still bracketed.
  const bare =
    trimmed.startsWith('[') && trimmed.endsWith(']')
      ? trimmed.slice(1, -1)
      : trimmed;

  if (isIPv4(bare)) return classifyIpv4(bare);
  if (isIPv6(bare)) return classifyIpv6(bare);
  // An IPv6 literal may carry a zone index (`fe80::1%eth0`), which the
  // validator rejects; the address before the `%` is what matters.
  const zoneSplit = bare.indexOf('%');
  if (zoneSplit > 0) {
    const withoutZone = bare.slice(0, zoneSplit);
    if (isIPv6(withoutZone)) return classifyIpv6(withoutZone);
  }
  return undefined;
}

function classifyIpv4(address: string): AddressScope {
  const octets = address.split('.').map((part) => Number(part));
  return classifyIpv4Octets(octets[0], octets[1], octets[2], octets[3]);
}

/**
 * The IPv4 special-purpose ranges, in the order a classifier must read them
 * (narrower ranges before the wider ones they sit inside). Every range that
 * is not globally routable is restricted, not only the three RFC 1918
 * blocks: a filter that stops at 10/8, 172.16/12 and 192.168/16 is the
 * classic incomplete SSRF filter, walked around with 169.254.169.254 (the
 * cloud metadata address) or a CGNAT address.
 */
function classifyIpv4Octets(a = 0, b = 0, c = 0, d = 0): AddressScope {
  if (a === 0)
    return b === 0 && c === 0 && d === 0 ? 'unspecified' : 'reserved';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  // Carrier-grade NAT (RFC 6598): a real LAN range on many networks.
  if (a === 100 && b >= 64 && b <= 127) return 'private';
  // Link-local, which contains the cloud metadata address 169.254.169.254.
  if (a === 169 && b === 254) return 'link-local';
  // IETF protocol assignments, and the benchmarking range.
  if (a === 192 && b === 0 && c === 0) return 'reserved';
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  // Documentation ranges (RFC 5737).
  if (a === 192 && b === 0 && c === 2) return 'reserved';
  if (a === 198 && b === 51 && c === 100) return 'reserved';
  if (a === 203 && b === 0 && c === 113) return 'reserved';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return 'public';
}

/**
 * Expands `address` to its sixteen bytes. The validator has already accepted
 * it, so this handles the two shapes that survive: groups of hex separated by
 * `:` with at most one `::` run, and a trailing dotted-quad.
 */
function ipv6Bytes(address: string): number[] | undefined {
  let head = address;
  let tail = '';
  const doubleColon = address.indexOf('::');
  if (doubleColon !== -1) {
    head = address.slice(0, doubleColon);
    tail = address.slice(doubleColon + 2);
  }

  const bytes: number[] = [];
  const pushGroup = (group: string): boolean => {
    // A trailing dotted-quad stands for the last four bytes.
    if (group.includes('.')) {
      if (!isIPv4(group)) return false;
      for (const part of group.split('.')) bytes.push(Number(part));
      return true;
    }
    const value = Number.parseInt(group, 16);
    if (!Number.isFinite(value)) return false;
    bytes.push((value >> 8) & 0xff, value & 0xff);
    return true;
  };

  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  for (const group of headGroups) if (!pushGroup(group)) return undefined;

  const tailBytes: number[] = [];
  const savedLength = bytes.length;
  for (const group of tailGroups) if (!pushGroup(group)) return undefined;
  tailBytes.push(...bytes.splice(savedLength));

  if (doubleColon === -1) {
    return bytes.length === 16 ? bytes : undefined;
  }
  const gap = 16 - bytes.length - tailBytes.length;
  if (gap < 0) return undefined;
  return [...bytes, ...new Array<number>(gap).fill(0), ...tailBytes];
}

function classifyIpv6(address: string): AddressScope {
  const bytes = ipv6Bytes(address.toLowerCase());
  // Unparseable after the validator accepted it should be impossible; treat
  // it as restricted anyway rather than letting an unknown shape through.
  if (!bytes) return 'reserved';

  /** Byte `index`, or 0 past the end. `bytes` is always sixteen long here; this keeps the reads total under `noUncheckedIndexedAccess`. */
  const at = (index: number): number => bytes[index] ?? 0;

  const allZero = (from: number, to: number): boolean =>
    bytes.slice(from, to).every((byte) => byte === 0);

  if (allZero(0, 16)) return 'unspecified';
  if (allZero(0, 15) && at(15) === 1) return 'loopback';

  // The three shapes that carry an IPv4 address inside an IPv6 one. Each is a
  // documented SSRF bypass when a filter classifies the wrapper instead of
  // the address it actually reaches, so each is classified by its payload.
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d).
  if (allZero(0, 10) && at(10) === 0xff && at(11) === 0xff) {
    return classifyIpv4Octets(at(12), at(13), at(14), at(15));
  }
  if (allZero(0, 12)) {
    return classifyIpv4Octets(at(12), at(13), at(14), at(15));
  }
  // 6to4 (2002::/16) embeds the IPv4 address in the next four bytes.
  if (at(0) === 0x20 && at(1) === 0x02) {
    return classifyIpv4Octets(at(2), at(3), at(4), at(5));
  }
  // NAT64 well-known prefix (64:ff9b::/96) embeds it in the last four.
  if (
    at(0) === 0x00 &&
    at(1) === 0x64 &&
    at(2) === 0xff &&
    at(3) === 0x9b &&
    allZero(4, 12)
  ) {
    return classifyIpv4Octets(at(12), at(13), at(14), at(15));
  }

  // Unique-local (fc00::/7).
  if ((at(0) & 0xfe) === 0xfc) return 'private';
  // Link-local (fe80::/10).
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) return 'link-local';
  // Multicast (ff00::/8).
  if (at(0) === 0xff) return 'multicast';
  // Documentation (2001:db8::/32) and the IETF protocol block (2001::/23).
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x0d && at(3) === 0xb8) {
    return 'reserved';
  }
  return 'public';
}
