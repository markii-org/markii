/**
 * The bundle path-jail (spec §11): pure functions, zero dependencies (not
 * even on Node builtins), so they're trivially unit-testable and reusable
 * from both the browser-safe zip storage and the Node-only directory
 * storage without either pulling in the other's runtime.
 *
 * IMPORTANT: percent-decoding is deliberately NOT applied anywhere in this
 * module. A path segment like `..%2F` is treated as a literal filename
 * (the three characters `.`, `.`, `%2F`... i.e. the six characters
 * `..%2F`), never decoded into `../`. Bundle paths are opaque strings, not
 * URLs — decoding them would let a percent-encoded traversal sequence slip
 * past the `..`-segment check below, which is exactly the class of bug this
 * module exists to prevent.
 */

/** The two write grants a manifest may declare under `permissions.bundle`. */
export type BundleFsGrant = 'read' | 'write:.cache/';

export type NormalizePathResult =
  { ok: true; path: string } | { ok: false; reason: string };

/** Matches a leading Windows drive letter, e.g. `C:` at the start of a path. */
const DRIVE_LETTER_RE = /^[A-Za-z]:/;

/**
 * Normalizes a bundle-relative path and rejects anything that could escape
 * the bundle root or address the filesystem outside it. This is the single
 * choke point every `BundleStorage` implementation must route through
 * before touching disk or an in-memory archive.
 *
 * Accepts: relative paths using `/` separators, with `.` segments and
 * repeated `/` collapsed, and a leading `./` stripped.
 *
 * Rejects: empty paths, null bytes, any backslash (so a literal `\` is
 * never mistaken for a path separator on a platform that treats it as one),
 * absolute paths (leading `/`), Windows drive-letter paths (`C:...`), and
 * any `..` segment, wherever it appears (start, middle, or end).
 */
export function normalizeBundlePath(path: string): NormalizePathResult {
  if (path.length === 0) {
    return { ok: false, reason: 'path is empty' };
  }
  if (path.includes('\0')) {
    return { ok: false, reason: 'path contains a null byte' };
  }
  if (path.includes('\\')) {
    return { ok: false, reason: 'backslashes are not allowed in bundle paths' };
  }
  if (path.startsWith('/')) {
    return { ok: false, reason: 'absolute paths are not allowed' };
  }
  if (DRIVE_LETTER_RE.test(path)) {
    return { ok: false, reason: 'drive-letter paths are not allowed' };
  }

  const segments: string[] = [];
  for (const segment of path.split('/')) {
    // Empty segments (repeated `/` or a trailing `/`) and `.` segments
    // collapse away silently — they carry no traversal meaning.
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      return { ok: false, reason: '".." path segments are not allowed' };
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    return { ok: false, reason: 'path has no meaningful segments' };
  }

  return { ok: true, path: segments.join('/') };
}

/** The write-access policy an untrusted script is evaluated against. */
export interface BundleWritePolicy {
  /** The `permissions.bundle` grants declared in the note's manifest. */
  grants: readonly BundleFsGrant[];
}

/**
 * Implements the write half of spec §11's bundle-scoped filesystem.
 *
 * `note.mk.md` and `manifest.json` are denied unconditionally, regardless of
 * `policy` — this is load-bearing, not a default: a script that could edit
 * the manifest could grant itself further permissions, and a script that
 * could edit `note.mk.md` would make the document self-modifying, which §8
 * explicitly rules out. Every other path requires the `write:.cache/` grant
 * and must normalize to a path under `.cache/`. The dot prefix is the one
 * spelling: `normalizeBundlePath` collapses a bare `.` segment away, so
 * `.cache/x` normalizes to a first segment of `.cache`, an ordinary
 * dot-prefixed directory name rather than a traversal segment (only a
 * literal `..` segment is rejected).
 */
export function isWriteAllowed(
  path: string,
  policy: BundleWritePolicy,
): boolean {
  const normalized = normalizeBundlePath(path);
  if (!normalized.ok) return false;

  const { path: p } = normalized;

  // Unconditional denial: no policy input can override this.
  if (p === 'note.mk.md' || p === 'manifest.json') return false;

  if (!policy.grants.includes('write:.cache/')) return false;

  return p.startsWith('.cache/') && p.length > '.cache/'.length;
}
