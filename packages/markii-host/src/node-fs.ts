/**
 * The Node-backed implementations of the file-system seams the
 * environment-free half of this package injects: pack discovery's file
 * reader and directory lister, the pack-scripts reader, and the `.mkp`
 * extraction filesystem. Reached only through `@markii/host/node`; nothing
 * in the main entry imports this module.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { ArchiveExtractFs } from './host/pack-archive.js';
import type { PackDiscoveryIo } from './host/pack-load.js';
import type { PackDirectoryLister, PackFileReader } from './packs/discover.js';
import type { PackScriptsReader } from './packs/pack-scripts.js';

/** The real, Node-backed `PackDirectoryLister`. Never rejects: an unreadable, missing or non-directory path resolves `[]`. */
export function createNodeDirectoryLister(): PackDirectoryLister {
  return async (absoluteDir) => {
    try {
      const entries = await readdir(absoluteDir, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
      }));
    } catch {
      return [];
    }
  };
}

/** The real, Node-backed `PackFileReader`. Never rejects: an unreadable or missing path resolves `undefined`. */
export function createNodeFileReader(): PackFileReader {
  return async (absolutePath) => {
    try {
      return await readFile(absolutePath, 'utf8');
    } catch {
      return undefined;
    }
  };
}

/** The real, Node-backed `PackScriptsReader`. */
export function createNodeReader(): PackScriptsReader {
  const listDirectory = createNodeDirectoryLister();
  const readText = createNodeFileReader();
  return {
    readDirectory: (absoluteDir) => listDirectory(absoluteDir),
    readFile: (absolutePath) => readText(absolutePath),
  };
}

/** The real, Node-backed `ArchiveExtractFs`. */
export function createNodeArchiveExtractFs(): ArchiveExtractFs {
  return {
    removeDirectory: async (absolutePath) => {
      try {
        await rm(absolutePath, { recursive: true, force: true });
      } catch {
        // Quiet: the write that follows fails loudly on its own if the
        // path is genuinely unusable.
      }
    },
    makeDirectory: async (absolutePath) => {
      await mkdir(absolutePath, { recursive: true });
    },
    writeFile: async (absolutePath, bytes) => {
      await writeFile(absolutePath, bytes);
    },
  };
}

/** Pack discovery's reads over the real file system. */
export function createNodePackDiscoveryIo(): PackDiscoveryIo {
  return {
    readFile: createNodeFileReader(),
    listDirectory: createNodeDirectoryLister(),
  };
}
