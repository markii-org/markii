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
    expect(isSnapshotSource('dist/esbuild-wasm/esbuild.wasm')).toBe(false);
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

  it('documents both the zip and BRAT install routes', () => {
    const readme = mirrorReadme('0.2.0');
    expect(readme).toContain('markii-0.2.0.zip');
    expect(readme).toContain('obsidian42-BRAT');
    expect(readme).toContain('https://github.com/markii-org/markii-obsidian');
  });

  it('states the pack-compilation caveat for the BRAT route', () => {
    const readme = mirrorReadme('0.2.0');
    expect(readme).toContain('webview.js');
    expect(readme).toContain('esbuild-wasm');
  });

  it('points the BRAT pack-compilation workaround at esbuild-wasm.zip', () => {
    const readme = mirrorReadme('0.2.0');
    expect(readme).toContain('esbuild-wasm.zip');
  });
});
