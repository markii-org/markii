import { describe, expect, it } from 'vitest';
import { isSnapshotSource, mirrorReadme } from './mirror-snapshot.ts';

describe('isSnapshotSource', () => {
  it('includes ordinary source files', () => {
    expect(isSnapshotSource('src/main.ts')).toBe(true);
    expect(isSnapshotSource('scripts/release/version.ts')).toBe(true);
    expect(isSnapshotSource('test-fixtures/example.mk.md')).toBe(true);
    expect(isSnapshotSource('manifest.json')).toBe(true);
    expect(isSnapshotSource('package.json')).toBe(true);
    expect(isSnapshotSource('tsconfig.json')).toBe(true);
    expect(isSnapshotSource('vitest.config.mts')).toBe(true);
    expect(isSnapshotSource('esbuild.config.mjs')).toBe(true);
    expect(isSnapshotSource('.gitignore')).toBe(true);
  });

  it('excludes build output', () => {
    expect(isSnapshotSource('dist/main.js')).toBe(false);
  });

  it('excludes node_modules and .git', () => {
    expect(isSnapshotSource('node_modules/foo/index.js')).toBe(false);
    expect(isSnapshotSource('.git/HEAD')).toBe(false);
  });

  it('excludes the generated styles.css at the root', () => {
    expect(isSnapshotSource('styles.css')).toBe(false);
  });

  it('does not exclude a styles.css nested elsewhere', () => {
    expect(isSnapshotSource('src/styles.css')).toBe(true);
  });

  it('excludes the authored root README, which mirrorReadme composes from', () => {
    expect(isSnapshotSource('README.md')).toBe(false);
  });

  it('does not exclude a README nested elsewhere', () => {
    expect(isSnapshotSource('src/README.md')).toBe(true);
  });

  it('excludes .DS_Store anywhere', () => {
    expect(isSnapshotSource('.DS_Store')).toBe(false);
    expect(isSnapshotSource('src/.DS_Store')).toBe(false);
  });
});

describe('mirrorReadme', () => {
  it('interpolates the version into the download instructions', () => {
    const readme = mirrorReadme('0.2.0');
    expect(readme).toContain('markii-0.2.0.zip');
  });

  it('contains no em dash character', () => {
    const readme = mirrorReadme('0.2.0');
    expect(readme).not.toContain('—');
  });

  it('documents both the zip and BRAT install routes as equivalent', () => {
    const readme = mirrorReadme('0.2.0');
    expect(readme).toContain('markii-0.2.0.zip');
    expect(readme).toContain('obsidian42-BRAT');
    expect(readme).toContain('https://github.com/markii-org/markii-obsidian');
    expect(readme).toContain('no functional difference');
  });

  it('states packs install only from a .mkp archive, with no compiler', () => {
    const readme = mirrorReadme('0.2.0');
    expect(readme).toContain('.mkp');
    expect(readme).toContain('no pack-folder setting and no');
  });

  it('lists every command the plugin registers, exports and pack reload included', () => {
    const readme = mirrorReadme('0.2.0');
    for (const command of [
      'Open Markii Preview',
      'Run Markii scripts',
      'Insert Markii component',
      'Export Markii note as HTML',
      'Export Markii note as PDF',
      'Toggle Markii script execution',
      'Install Markii pack from file',
      'Reload Markii packs',
      'Show Markii diagnostics',
    ]) {
      expect(readme).toContain(command);
    }
  });

  it('separates the vault-synced cosmetic settings from the device-local scripting ones', () => {
    const readme = mirrorReadme('0.2.0');
    expect(readme).toContain('Hide script blocks');
    expect(readme).toContain('Turn off script execution on this device');
    expect(readme).toContain('stored on this device');
  });

  it('keeps the mirror-only sections around the authored body', () => {
    const readme = mirrorReadme('0.2.0');
    const intro = readme.indexOf('read-only release mirror');
    const install = readme.indexOf('## Install');
    const sourceNote = readme.indexOf('## About the source in this repository');
    const license = readme.indexOf('## License');
    expect(intro).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(intro);
    expect(sourceNote).toBeGreaterThan(install);
    expect(license).toBeGreaterThan(sourceNote);
  });

  it('leaves no unsubstituted version placeholder', () => {
    expect(mirrorReadme('0.2.0')).not.toContain('{{VERSION}}');
  });

  it('states the PDF command degrades to writing HTML rather than failing', () => {
    const readme = mirrorReadme('0.2.0');
    expect(readme).toContain('writes the HTML file instead');
  });
});
