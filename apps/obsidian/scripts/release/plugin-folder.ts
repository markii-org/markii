// Assembles an installable Obsidian plugin folder from a built workspace.
//
// Obsidian loads a plugin from a single flat folder named after the
// manifest's `id`, placed directly under `<vault>/.obsidian/plugins/`. Our
// build instead produces `dist/` (the esbuild output) alongside the
// workspace's own `manifest.json` and generated `styles.css`. This module
// does the flattening: it is the one place that knows the runtime layout
// Obsidian expects, so a change to what the plugin loads at runtime only
// has to be taught here.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';

// The esbuild-wasm compiler runtime: pack compilation. Without these two
// files, installing a component pack that ships source rather than a
// prebuilt webview.js fails to compile
// (apps/obsidian/src/packs/pack-compilation.ts degrades that cleanly rather
// than breaking). Also attached to a release as its own asset
// (esbuild-wasm.zip, see build-release.ts's runtime-staging step and
// .github/workflows/obsidian-release.yml) so a BRAT install, which only ever
// fetches loose files, can add pack compilation without a full reinstall.
export const ESBUILD_RUNTIME_FILES: readonly string[] = [
  'esbuild-wasm/lib/browser.js',
  'esbuild-wasm/esbuild.wasm',
];

// Every entry here is load-bearing at runtime, not merely part of the build
// output:
//   - main.js is the plugin entry point Obsidian actually loads. It now
//     carries the Run path's isolate too: the worker bundle and its Lua
//     wasm glue are base64-embedded inside it (GitHub issue #13 step 2), so
//     worker.browser.js and glue.wasm are no longer emitted as separate
//     files and are deliberately absent from this list.
//   - manifest.json and styles.css are read by Obsidian itself (id/version
//     detection, and the document stylesheet the preview depends on).
//   - ESBUILD_RUNTIME_FILES stay required here because they must be present
//     in the assembled plugin folder before anything can stage or zip them
//     as a release asset, even though they now also ship separately as
//     esbuild-wasm.zip (see above) rather than only inside the plugin zip.
export const REQUIRED_PLUGIN_FILES: readonly string[] = [
  'main.js',
  'manifest.json',
  'styles.css',
  ...ESBUILD_RUNTIME_FILES,
];

export function listFilesRecursively(dir: string): string[] {
  const results: string[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(relative(dir, full).split(sep).join('/'));
      }
    }
  };

  walk(dir);
  results.sort();
  return results;
}

function readManifestId(manifestPath: string): string {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  if (
    raw === null ||
    typeof raw !== 'object' ||
    !('id' in raw) ||
    typeof (raw as { id: unknown }).id !== 'string' ||
    (raw as { id: string }).id.length === 0
  ) {
    throw new Error(
      `${manifestPath} is missing a string "id" field — the plugin folder name comes from it and cannot be assembled without it`,
    );
  }
  return (raw as { id: string }).id;
}

export function assemblePluginFolder(options: {
  appDir: string;
  outDir: string;
}): { pluginDir: string; files: string[] } {
  const { appDir, outDir } = options;
  const manifestPath = join(appDir, 'manifest.json');
  const stylesPath = join(appDir, 'styles.css');
  const distDir = join(appDir, 'dist');

  if (!existsSync(distDir)) {
    throw new Error(
      `${distDir} does not exist — run "npm run build -w markii-obsidian" first`,
    );
  }
  if (!existsSync(stylesPath)) {
    throw new Error(
      `${stylesPath} does not exist — run "npm run generate:doc-css -w markii-obsidian" (or the build, which runs it automatically) first`,
    );
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`${manifestPath} does not exist`);
  }

  const pluginId = readManifestId(manifestPath);
  const pluginDir = join(outDir, pluginId);
  mkdirSync(pluginDir, { recursive: true });

  copyFileSync(manifestPath, join(pluginDir, 'manifest.json'));
  copyFileSync(stylesPath, join(pluginDir, 'styles.css'));

  for (const relPath of listFilesRecursively(distDir)) {
    const dest = join(pluginDir, relPath);
    mkdirSync(join(dest, '..'), { recursive: true });
    copyFileSync(join(distDir, relPath), dest);
  }

  const files = listFilesRecursively(pluginDir);
  const fileSet = new Set(files);
  const missing = REQUIRED_PLUGIN_FILES.filter((f) => !fileSet.has(f));
  if (missing.length > 0) {
    throw new Error(
      `assembled plugin folder ${pluginDir} is missing required file(s): ${missing.join(', ')} — run "npm run build -w markii-obsidian" first so dist/ and styles.css are up to date`,
    );
  }

  return { pluginDir, files };
}

// Stages the esbuild-wasm compiler runtime out of an already-assembled
// plugin folder (see assemblePluginFolder above) into its own output
// directory, preserving the `esbuild-wasm/...` relative layout so zipping
// that directory produces a single `esbuild-wasm/` folder that sits next to
// main.js when extracted. This is the release-asset path (issue #25,
// variant A): the plugin never downloads this itself, CI attaches it to the
// release as esbuild-wasm.zip instead.
export function stageEsbuildRuntime(options: {
  pluginDir: string;
  outDir: string;
}): { files: string[] } {
  const { pluginDir, outDir } = options;

  const missing = ESBUILD_RUNTIME_FILES.filter(
    (relPath) => !existsSync(join(pluginDir, relPath)),
  );
  if (missing.length > 0) {
    throw new Error(
      `plugin folder ${pluginDir} is missing required esbuild-wasm runtime file(s): ${missing.join(', ')} — run "npm run build -w markii-obsidian" first so dist/ is up to date`,
    );
  }

  for (const relPath of ESBUILD_RUNTIME_FILES) {
    const dest = join(outDir, relPath);
    mkdirSync(join(dest, '..'), { recursive: true });
    copyFileSync(join(pluginDir, relPath), dest);
  }

  const files = [...ESBUILD_RUNTIME_FILES];
  files.sort();
  return { files };
}
