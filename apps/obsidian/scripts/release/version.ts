// Version gating for an Obsidian plugin release.
//
// Obsidian's update detection works by comparing the `version` field in a
// plugin's manifest.json against the version installed. There is no other
// signal: a release whose tag doesn't match manifest.json (or the workspace
// package.json, which must move in lockstep) ships a "new" version that
// nobody's Obsidian client will ever notice, because the manifest that
// travels with the release still reports the old number. This gate exists
// to catch that class of mistake before a release goes out, not after.

export const TAG_PREFIX = 'obsidian-v';

const TAG_PATTERN = /^obsidian-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export function versionFromTag(tag: string): string | null {
  const match = TAG_PATTERN.exec(tag);
  return match?.[1] ?? null;
}

export interface VersionCheckInput {
  tag: string;
  manifestVersion: string;
  packageVersion: string;
}

export interface VersionCheckResult {
  version: string | null;
  problems: string[];
}

export function checkReleaseVersions(
  input: VersionCheckInput,
): VersionCheckResult {
  const problems: string[] = [];
  const version = versionFromTag(input.tag);

  if (version === null) {
    problems.push(
      `tag "${input.tag}" does not match the required pattern "${TAG_PREFIX}<major>.<minor>.<patch>[-prerelease]" (e.g. "${TAG_PREFIX}0.2.0")`,
    );
    return { version: null, problems };
  }

  if (input.manifestVersion !== version) {
    problems.push(
      `manifest.json version "${input.manifestVersion}" does not match tag version "${version}"`,
    );
  }

  if (input.packageVersion !== version) {
    problems.push(
      `package.json version "${input.packageVersion}" does not match tag version "${version}"`,
    );
  }

  return { version, problems };
}
