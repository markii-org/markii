/**
 * Host-side (extension-host, `vscode`-free) loader that reads every pack's
 * `scripts/*.lua` files ahead of a run, producing the `PackModulesMap`
 * `./lua-resolver.ts`'s `createPackModuleResolver` looks up synchronously
 * inside the Run worker — see that module's doc comment for why the
 * reading happens here, on the host, rather than inside the worker.
 *
 * Filesystem access is injected (`PackScriptsReader`) so this module is
 * testable with an in-memory fake; `createNodeReader` below is the real
 * `node:fs/promises`-backed implementation `preview-panel.ts` wires up,
 * kept in this file (not `preview-panel.ts`) only because it needs no
 * `vscode` API at all — plain `node:fs` is fine outside the
 * `vscode`-import allowlist (see AGENTS.md's file-scope split, which is
 * about the `vscode` module specifically, not Node builtins).
 */
import { readdir, readFile as nodeReadFile } from 'node:fs/promises';
import * as path from 'node:path';
import { normalizeBundlePath } from '@markii/bundle';
import type { DiscoveredPack } from './discover.js';
import type { PackModulesMap } from './lua-resolver.js';

export interface PackScriptsReader {
  /** Lists one directory's immediate entries, or `[]` if it does not exist / cannot be read (never throws — a pack with no `scripts/` folder is the ordinary case). */
  readDirectory(
    absoluteDir: string,
  ): Promise<ReadonlyArray<{ name: string; isDirectory: boolean }>>;
  /** Reads one file's UTF-8 text, or `undefined` if it cannot be read. */
  readFile(absolutePath: string): Promise<string | undefined>;
}

/** The real, Node-backed `PackScriptsReader` — what `preview-panel.ts` supplies in the packaged extension and in dev. */
export function createNodeReader(): PackScriptsReader {
  return {
    async readDirectory(absoluteDir) {
      try {
        const entries = await readdir(absoluteDir, { withFileTypes: true });
        return entries.map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        }));
      } catch {
        return [];
      }
    },
    async readFile(absolutePath) {
      try {
        return await nodeReadFile(absolutePath, 'utf8');
      } catch {
        return undefined;
      }
    },
  };
}

/** A sane upper bound on how many `.lua` files one pack's `scripts/` tree may contribute — defense in depth against a pathological pack folder (a symlink cycle a directory walk would otherwise never terminate on, or simply an absurd number of files) turning "load the installed packs" into an unbounded scan. */
const MAX_SCRIPT_FILES_PER_PACK = 500;

/** Recursion depth cap for the same reason — a plain bound alongside the file-count cap, independent of it. */
const MAX_SCRIPT_DIR_DEPTH = 16;

/**
 * Walks `pack.scriptsDir` (relative to it) collecting every `.lua` file's
 * bundle-jail-normalized relative path -> source text. A relative path the
 * jail rejects (should not arise from a real directory listing, but this is
 * defense in depth, matching every other filesystem-adjacent module in this
 * codebase) is silently skipped rather than throwing — same cleanliness
 * posture as `./discover.ts`. An unreadable individual file is skipped the
 * same way.
 */
async function collectPackModules(
  pack: DiscoveredPack,
  reader: PackScriptsReader,
): Promise<Record<string, string>> {
  const result: Record<string, string> = Object.create(null);
  let fileCount = 0;

  async function walk(relativeDir: string, depth: number): Promise<void> {
    if (depth > MAX_SCRIPT_DIR_DEPTH) return;
    const absoluteDir = relativeDir
      ? path.join(pack.scriptsDir, relativeDir)
      : pack.scriptsDir;
    const entries = await reader.readDirectory(absoluteDir);

    for (const entry of entries) {
      if (fileCount >= MAX_SCRIPT_FILES_PER_PACK) return;
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;

      if (entry.isDirectory) {
        await walk(relativePath, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.lua')) continue;

      const normalized = normalizeBundlePath(relativePath);
      if (!normalized.ok) continue;

      const absolutePath = path.join(pack.scriptsDir, relativePath);
      const source = await reader.readFile(absolutePath);
      if (source === undefined) continue;

      result[normalized.path] = source;
      fileCount += 1;
    }
  }

  await walk('', 0);
  return result;
}

/**
 * Builds the full `PackModulesMap` for `packs`: every discovered pack's
 * namespace mapped to its `scripts/*.lua` files, keyed by their
 * jail-normalized relative path. A pack with no `scripts/` directory (or an
 * unreadable one) simply contributes an empty module map — a
 * `require "thatPack/anything"` then resolves as an ordinary "no such
 * module", never a crash.
 */
export async function loadPackModules(
  packs: readonly DiscoveredPack[],
  reader: PackScriptsReader = createNodeReader(),
): Promise<PackModulesMap> {
  const map: Record<string, Record<string, string>> = Object.create(null);
  for (const pack of packs) {
    map[pack.manifest.name] = await collectPackModules(pack, reader);
  }
  return map;
}
