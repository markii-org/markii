/**
 * Resolve-then-pin for the run path's network jail (GitHub issue #10).
 *
 * A network grant is a hostname string. Between granting the name and
 * reaching it, two things can go wrong that a hostname check cannot see:
 *
 *   - the name can resolve somewhere the user never intended (a public name
 *     answering with a private address, which is SSRF against their own
 *     machine or LAN, including the cloud metadata address);
 *   - the record can change between the check and the connection (DNS
 *     rebinding), so even a checked name can be connected to somewhere else.
 *
 * This module closes both by resolving a host ONCE, vetting every address the
 * resolver returned, and handing back the single address the request must
 * then be pinned to. `docs/security.md` documented these as accepted limits
 * of a hostname allowlist; this is the code that closes them.
 *
 * Pure apart from the injected `lookup`, so every branch is testable without
 * a resolver or a socket.
 */
import {
  classifyIpAddress,
  describeScope,
  isRestrictedScope,
  type AddressScope,
} from './ip-address.js';

/** One address a resolver returned. Matches `dns.promises.lookup(host, { all: true })`'s shape. */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Resolves a hostname to every address it has. Injected so tests never touch a real resolver. */
export type HostLookup = (hostname: string) => Promise<ResolvedAddress[]>;

/** The address a request is pinned to, and what kind of place it is. */
export interface PinnedAddress {
  address: string;
  family: 4 | 6;
  scope: AddressScope;
  /** True when the grant named an address (or `localhost`) directly, so no name-to-address surprise was possible. */
  literal: boolean;
}

export type PinResult =
  { ok: true; pinned: PinnedAddress } | { ok: false; reason: string };

export interface PinPolicy {
  /**
   * The deployment opt-in from issue #10: allow a NAMED host to resolve into
   * a private, loopback, or link-local range. Off by default, and off is the
   * posture that closes the SSRF case. A deployment whose internal DNS
   * legitimately points names at RFC 1918 space (a corporate `git.internal`)
   * turns it on knowingly.
   */
  allowRestrictedAddresses: boolean;
}

/**
 * `localhost` is special-cased alongside IP literals, per RFC 6761: it and
 * anything under `.localhost` are defined to mean the loopback interface, so
 * granting the name IS granting loopback. There is no surprise to protect the
 * user from and no rebinding to prevent, since the name is not resolved on
 * the network at all.
 */
function isLoopbackName(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower.endsWith('.localhost');
}

/**
 * Vets `hostname` and returns the one address the caller must connect to.
 *
 * The rule, in one sentence: a name may only be reached at a public address,
 * unless the grant itself named a literal address or `localhost` (in which
 * case the user chose that address knowingly, and the prompt says so), or the
 * deployment has opted in.
 *
 * A host whose resolver returns a mix of public and restricted addresses is
 * refused OUTRIGHT rather than filtered down to the public ones. Picking the
 * public address out of a mixed answer is precisely what a rebinding attacker
 * wants: it keeps their name reachable while they wait for the pin to expire.
 */
export async function pinHostAddress(
  hostname: string,
  policy: PinPolicy,
  lookup: HostLookup,
): Promise<PinResult> {
  const literalScope = classifyIpAddress(hostname);
  if (literalScope !== undefined) {
    const bare =
      hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;
    // The grant named this exact address: there is nothing to resolve, so
    // there is nothing to pin against and no range to second-guess.
    return {
      ok: true,
      pinned: {
        address: bare,
        family: bare.includes(':') ? 6 : 4,
        scope: literalScope,
        literal: true,
      },
    };
  }

  if (isLoopbackName(hostname)) {
    return {
      ok: true,
      pinned: {
        address: '127.0.0.1',
        family: 4,
        scope: 'loopback',
        literal: true,
      },
    };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    // Deliberately not the resolver's own message: it varies by platform and
    // says nothing a note's author can act on.
    return { ok: false, reason: `host "${hostname}" could not be resolved` };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: `host "${hostname}" resolved to no address` };
  }

  for (const candidate of addresses) {
    const scope = classifyIpAddress(candidate.address);
    if (scope === undefined) {
      return {
        ok: false,
        reason: `host "${hostname}" resolved to an unusable address`,
      };
    }
    if (isRestrictedScope(scope) && !policy.allowRestrictedAddresses) {
      return {
        ok: false,
        reason: `host "${hostname}" resolves to ${describeScope(scope)}`,
      };
    }
  }

  const chosen = addresses[0];
  if (chosen === undefined) {
    return { ok: false, reason: `host "${hostname}" resolved to no address` };
  }
  const scope = classifyIpAddress(chosen.address) ?? 'reserved';
  return {
    ok: true,
    pinned: {
      address: chosen.address,
      family: chosen.family === 6 ? 6 : 4,
      scope,
      literal: false,
    },
  };
}

/**
 * The `lookup` a pinned request installs on its own connection. Node calls it
 * instead of the real resolver, so the socket can only ever go to
 * `pinned.address` — the resolve-then-connect gap is closed by construction
 * rather than by re-checking after the fact.
 *
 * The callback has two shapes and BOTH must be handled: Node's own
 * `net.connect` calls this with `{ all: true }` and expects an array, while
 * the single-address form is what a caller passing `{ all: false }` gets.
 * Answering only the single form throws `ERR_INVALID_IP_ADDRESS` inside
 * Node's connect path (verified against Node 22).
 */
export function pinnedLookup(pinned: PinnedAddress) {
  return (
    _hostname: string,
    options: { all?: boolean },
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | ResolvedAddress[],
      family?: number,
    ) => void,
  ): void => {
    if (options.all === true) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}
