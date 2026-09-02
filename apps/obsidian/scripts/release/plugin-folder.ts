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

// Every entry here is load-bearing at runtime, not merely part of the build
// output. This plugin is a plain three-file install (AGENTS.md's Host
// positioning: Obsidian is archive-only, with no pack compiler of its own,
// so there is no esbuild-wasm runtime to stage or ship any more):
//   - main.js is the plugin entry point Obsidian actually loads. It
//     carries the Run path's isolate too: the worker bundle and its Lua
//     wasm glue are base64-embedded inside it, as are the three bundled
//     packs (read, dash, prep) — none of those are ever emitted as
//     separate files.
//   - manifest.json and styles.css are read by Obsidian itself (id/version
//     detection, and the document stylesheet the preview depends on).
export const REQUIRED_PLUGIN_FILES: readonly string[] = [
  'main.js',
  'manifest.json',
  'styles.css',
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
