import type { BundleFsGrant } from './paths.js';

/**
 * `manifest.json`'s contract (spec §9–§11). `mark` is the only required
 * field. The index signature keeps unrecognized top-level keys typed as
 * `unknown` rather than dropped — `parseManifest` preserves them verbatim
 * (see the "forward compatibility" note there) so a manifest written by a
 * newer spec version round-trips through an older implementation intact.
 */
export interface BundleManifest {
  /** Spec semver this bundle was authored against, e.g. `"0.1.0"`. */
  mark: string;
  permissions?: BundlePermissions;
  uses?: string[];
  /**
   * Optional bundle-relative path to the document to open, overriding the
   * conventional `note.mk.md`. `parseManifest` only checks that this is a
   * string; it does not reject `../` or an absolute path here. Path-jailing
   * is done once, at use time, by the consumer's `normalizeBundlePath` (see
   * `./paths.ts`) — matching the parity of every other manifest field, none
   * of which pre-jail path-shaped values either. Keeping the single jail
   * point at use time avoids duplicating (and risking drift from) that
   * logic here.
   */
  document?: string;
  [key: string]: unknown;
}

export interface BundlePermissions {
  net?: {
    /** Bare hostnames (no scheme/port/path/wildcard) allowed for GET. */
    get?: string[];
    /** Bare hostnames allowed for POST. */
    post?: string[];
  };
  /** Bundle-filesystem grants; see `isWriteAllowed` in `./paths`. */
  bundle?: BundleFsGrant[];
}

export type ManifestParseResult =
  | { ok: true; manifest: BundleManifest; warnings: string[] }
  | { ok: false; errors: string[] };

/** The current spec version this package's default manifests declare. */
export const CURRENT_SPEC_VERSION = '0.1.0';

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'mark',
  'permissions',
  'uses',
  'document',
]);
const KNOWN_FS_GRANTS = new Set<string>(['read', 'write:cache/']);

// Simplified but structurally correct semver: MAJOR.MINOR.PATCH with
// optional prerelease/build metadata. Good enough for a "shape" check —
// this package does not need to compare or range-match versions.
const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// Bare hostname only: letters/digits/hyphens in dot-separated labels, no
// scheme (`https://`), no port (`:8080`), no path (`/x`), no wildcard (`*`).
const HOSTNAME_RE =
  /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Hand-rolled `manifest.json` validation (no schema library — see AGENTS.md
 * dependency policy). Never throws: malformed JSON, a non-object root, or
 * any other malformed input all come back as `{ ok: false, errors }`.
 *
 * Unknown top-level keys are forward-compatible: they produce warnings, not
 * errors, and are preserved on the returned `manifest` object untouched, so
 * a manifest field introduced by a future spec version doesn't break an
 * older implementation and isn't silently discarded if that manifest is
 * later re-serialized.
 *
 * Judgment call: this forward-compatibility guarantee is *top-level only*,
 * matching the task contract literally. An unrecognized key nested inside
 * `permissions` (e.g. a future `permissions.fs`) is currently dropped
 * rather than preserved, since `permissions` itself is a known, normalized
 * key. Extending preservation to arbitrary nesting depth would be a
 * reasonable follow-up but wasn't asked for here.
 */
export function parseManifest(json: string): ManifestParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      errors: [
        `malformed JSON: ${err instanceof Error ? err.message : String(err)}`,
      ],
    };
  }

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['manifest must be a JSON object'] };
  }

  const obj = raw;
  const errors: string[] = [];
  const warnings: string[] = [];

  // --- mark (required) ---
  const markRaw = obj.mark;
  if (typeof markRaw !== 'string') {
    errors.push('"mark" is required and must be a string');
  } else if (!SEMVER_RE.test(markRaw)) {
    errors.push(
      `"mark" must be a semver string (got ${JSON.stringify(markRaw)})`,
    );
  }

  // --- permissions (optional) ---
  let permissions: BundlePermissions | undefined;
  if (obj.permissions !== undefined) {
    if (!isPlainObject(obj.permissions)) {
      errors.push('"permissions" must be an object');
    } else {
      const permsObj = obj.permissions;
      const perms: BundlePermissions = {};

      if (permsObj.net !== undefined) {
        if (!isPlainObject(permsObj.net)) {
          errors.push('"permissions.net" must be an object');
        } else {
          const netObj = permsObj.net;
          const net: { get?: string[]; post?: string[] } = {};
          for (const method of ['get', 'post'] as const) {
            const hosts = netObj[method];
            if (hosts === undefined) continue;
            if (!isStringArray(hosts)) {
              errors.push(
                `"permissions.net.${method}" must be an array of strings`,
              );
              continue;
            }
            const badHosts = hosts.filter((host) => !HOSTNAME_RE.test(host));
            if (badHosts.length > 0) {
              errors.push(
                `"permissions.net.${method}" must list bare hostnames only ` +
                  `(no scheme, port, path, or wildcard) — invalid: ${badHosts.join(', ')}`,
              );
            } else {
              net[method] = hosts;
            }
          }
          perms.net = net;
        }
      }

      if (permsObj.bundle !== undefined) {
        if (!isStringArray(permsObj.bundle)) {
          errors.push('"permissions.bundle" must be an array of strings');
        } else {
          const badGrants = permsObj.bundle.filter(
            (grant) => !KNOWN_FS_GRANTS.has(grant),
          );
          if (badGrants.length > 0) {
            errors.push(
              `"permissions.bundle" contains invalid grant(s): ${badGrants.join(', ')} ` +
                `(expected "read" or "write:cache/")`,
            );
          } else {
            perms.bundle = permsObj.bundle as BundleFsGrant[];
          }
        }
      }

      permissions = perms;
    }
  }

  // --- uses (optional) ---
  let uses: string[] | undefined;
  if (obj.uses !== undefined) {
    if (!isStringArray(obj.uses)) {
      errors.push('"uses" must be an array of strings');
    } else {
      uses = obj.uses;
    }
  }

  // --- document (optional) ---
  // Only the type is checked here (must be a string). Whether it's a usable
  // relative path (no `../` escape, not absolute) is left to the consumer's
  // `normalizeBundlePath` at use time — see the type-level doc comment above
  // for why: no other manifest field pre-jails a path-shaped value either,
  // so enforcing it here would be inconsistent and would duplicate the one
  // real jail point.
  let document: string | undefined;
  if (obj.document !== undefined) {
    if (typeof obj.document !== 'string') {
      errors.push('"document" must be a string');
    } else {
      document = obj.document;
    }
  }

  // --- unknown top-level keys: forward-compat warning, not an error ---
  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(
        `unknown manifest key "${key}" (ignored by this implementation)`,
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const manifest: BundleManifest = { ...obj, mark: markRaw as string };
  if (permissions !== undefined) manifest.permissions = permissions;
  if (uses !== undefined) manifest.uses = uses;
  if (document !== undefined) manifest.document = document;

  return { ok: true, manifest, warnings };
}

/** A minimal, valid manifest for a freshly promoted bundle: no permissions granted, no packs declared. */
export function createDefaultManifest(
  specVersion: string = CURRENT_SPEC_VERSION,
): BundleManifest {
  return { mark: specVersion };
}
