import { describe, expect, it } from 'vitest';
import { TAG_PREFIX, checkReleaseVersions, versionFromTag } from './version.ts';

describe('versionFromTag', () => {
  it('accepts a well-formed tag', () => {
    expect(versionFromTag('obsidian-v0.2.0')).toBe('0.2.0');
  });

  it('rejects a tag with the wrong prefix', () => {
    expect(versionFromTag('v0.2.0')).toBeNull();
  });

  it('rejects a tag with an incomplete version', () => {
    expect(versionFromTag('obsidian-v0.2')).toBeNull();
  });

  it('accepts a prerelease tag', () => {
    expect(versionFromTag('obsidian-v0.2.0-beta.1')).toBe('0.2.0-beta.1');
  });

  it('uses the documented prefix constant', () => {
    expect(TAG_PREFIX).toBe('obsidian-v');
  });
});

describe('checkReleaseVersions', () => {
  it('has no problems when tag, manifest, and package all agree', () => {
    const result = checkReleaseVersions({
      tag: 'obsidian-v0.2.0',
      manifestVersion: '0.2.0',
      packageVersion: '0.2.0',
    });
    expect(result.version).toBe('0.2.0');
    expect(result.problems).toEqual([]);
  });

  it('reports a malformed tag', () => {
    const result = checkReleaseVersions({
      tag: 'v0.2.0',
      manifestVersion: '0.2.0',
      packageVersion: '0.2.0',
    });
    expect(result.version).toBeNull();
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('v0.2.0');
  });

  it('reports a manifest.json mismatch', () => {
    const result = checkReleaseVersions({
      tag: 'obsidian-v0.2.0',
      manifestVersion: '0.1.9',
      packageVersion: '0.2.0',
    });
    expect(result.version).toBe('0.2.0');
    expect(result.problems).toEqual([
      'manifest.json version "0.1.9" does not match tag version "0.2.0"',
    ]);
  });

  it('reports a package.json mismatch', () => {
    const result = checkReleaseVersions({
      tag: 'obsidian-v0.2.0',
      manifestVersion: '0.2.0',
      packageVersion: '0.1.9',
    });
    expect(result.version).toBe('0.2.0');
    expect(result.problems).toEqual([
      'package.json version "0.1.9" does not match tag version "0.2.0"',
    ]);
  });

  it('reports both mismatches when both are wrong', () => {
    const result = checkReleaseVersions({
      tag: 'obsidian-v0.2.0',
      manifestVersion: '0.1.0',
      packageVersion: '0.1.1',
    });
    expect(result.version).toBe('0.2.0');
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toContain('manifest.json');
    expect(result.problems[1]).toContain('package.json');
  });
});
