/**
 * Thrown by a `BundleStorage` implementation when a path fails the
 * path-jail (`normalizeBundlePath`) or — for the directory form — when a
 * `fs.realpath` re-check finds the resolved target has escaped the bundle
 * root via a symlink. Both are the same class of violation from the
 * caller's perspective: "this path does not stay inside the bundle."
 */
export class BundlePathError extends Error {
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string) {
    super(`invalid bundle path ${JSON.stringify(path)}: ${reason}`);
    this.name = 'BundlePathError';
    this.path = path;
    this.reason = reason;
  }
}

/**
 * Thrown by `openZipBundle` when the archive contains one or more entries
 * whose names fail the path-jail (zip-slip candidates: `../`, absolute
 * paths, backslash paths, drive letters). Deliberately loud — a tampered
 * bundle is rejected outright, never silently pruned to "the safe entries."
 */
export class BundleZipError extends Error {
  readonly entries: readonly string[];

  constructor(message: string, entries: readonly string[]) {
    super(message);
    this.name = 'BundleZipError';
    this.entries = entries;
  }
}

/**
 * Thrown by a `ScriptView` (see `./script-view`) when the manifest does not
 * grant the capability a call requires. Distinct from `BundlePathError`:
 * this is a permissions failure, not a malformed-path failure, and a future
 * script runtime should be able to tell the two apart (e.g. to show "needs
 * permission" vs. "invalid path" to the note author).
 */
export class ScriptCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptCapabilityError';
  }
}
