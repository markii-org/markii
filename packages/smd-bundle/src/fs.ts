// Node-only: exported solely via the "./fs" subpath (see package.json),
// mirroring smd-core's "./corpus" split — a browser bundler resolving this
// package's main entry never has to reason about `node:fs`.
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { BundlePathError } from './errors';
import { createDefaultManifest, CURRENT_SPEC_VERSION } from './manifest';
import type { BundleStorage } from './storage';
import { normalizeOrThrow } from './storage';
import { exportZipBundle, openZipBundle } from './zip';

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

function isEnoent(err: unknown): boolean {
  return isErrnoException(err) && err.code === 'ENOENT';
}

/**
 * Resolves `rootAbs/relPath` (both already-safe: `relPath` has passed
 * `normalizeOrThrow`) and re-verifies via `fs.realpath` that the result
 * stays inside the realpath of `rootAbs`, defeating a symlink planted
 * *inside* the bundle directory that points outside it — the path-jail in
 * `./paths` alone only rejects syntactically bad paths; it can't see that
 * `cache/link` on disk actually resolves to `/etc`.
 *
 * Walks up from the full target toward `rootAbs` until it finds the
 * nearest existing ancestor (the target itself may not exist yet, e.g. a
 * fresh write), realpaths *that* ancestor, and checks the reconstructed
 * path is still inside the root's realpath. Any symlink anywhere along the
 * existing portion of the path is therefore resolved and checked, whether
 * or not the leaf itself exists.
 *
 * Returns the plain (non-realpath) `rootAbs`-joined path for the caller to
 * actually operate on — once we know no existing ancestor escapes, it's
 * safe to `mkdir`/`writeFile`/`readFile` against the logical path.
 */
async function resolveInsideRoot(
  rootAbs: string,
  relPath: string,
): Promise<string> {
  const rootReal = await realpath(rootAbs);
  const target = join(rootAbs, relPath);

  let current = target;
  const pendingSegments: string[] = [];

  for (;;) {
    try {
      const currentReal = await realpath(current);
      const reconstructed =
        pendingSegments.length > 0
          ? join(currentReal, ...pendingSegments.slice().reverse())
          : currentReal;

      const rel = relative(rootReal, reconstructed);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new BundlePathError(
          relPath,
          'resolved path escapes the bundle root',
        );
      }
      return target;
    } catch (err) {
      if (err instanceof BundlePathError) throw err;
      if (!isEnoent(err)) throw err;

      const parent = dirname(current);
      if (parent === current) {
        // Walked all the way to a filesystem root without finding an
        // existing ancestor — shouldn't happen since rootAbs itself must
        // exist (realpath(rootAbs) above would have thrown otherwise).
        throw new BundlePathError(
          relPath,
          'unable to resolve path within bundle root',
        );
      }
      pendingSegments.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Opens the directory form of a bundle: reads/writes go straight to disk
 * under `rootDir`, with every operation re-verified against symlink escape
 * (see `resolveInsideRoot`). `rootDir` must already exist.
 */
export function openDirBundle(rootDir: string): BundleStorage {
  const rootAbs = resolve(rootDir);

  return {
    async read(path) {
      const relPath = normalizeOrThrow(path);
      const target = await resolveInsideRoot(rootAbs, relPath);
      try {
        const buf = await readFile(target);
        // `readFile` resolves a Node `Buffer` (a `Uint8Array` subclass).
        // Re-view it as a plain `Uint8Array` so callers get the type this
        // interface promises, not an implementation detail that happens to
        // compare unequal to a literal `Uint8Array` under deep-equality.
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      } catch (err) {
        if (isEnoent(err)) return undefined;
        throw err;
      }
    },
    async write(path, data) {
      const relPath = normalizeOrThrow(path);
      const target = await resolveInsideRoot(rootAbs, relPath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    async list() {
      const results: string[] = [];
      const walk = async (dirAbs: string, prefix: string): Promise<void> => {
        const entries = await readdir(dirAbs, { withFileTypes: true });
        for (const entry of entries) {
          // Never follow symlinked entries during enumeration: a symlink
          // planted inside the bundle dir could otherwise leak the
          // directory structure (or contents) of wherever it points.
          if (entry.isSymbolicLink()) continue;
          const entryRelPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            await walk(join(dirAbs, entry.name), entryRelPath);
          } else if (entry.isFile()) {
            results.push(entryRelPath);
          }
        }
      };
      await walk(rootAbs, '');
      return results.sort();
    },
    async exists(path) {
      const relPath = normalizeOrThrow(path);
      const target = await resolveInsideRoot(rootAbs, relPath);
      try {
        const info = await stat(target);
        return info.isFile();
      } catch (err) {
        if (isEnoent(err)) return false;
        throw err;
      }
    },
  };
}

/**
 * Scaffolds a brand-new bundle directory: `dir/note.smd` with `smdText` as
 * its content, plus a default `dir/manifest.json` (no permissions granted,
 * no packs declared). Creates `dir` if it doesn't already exist.
 */
export async function promoteToBundle(
  smdText: string,
  dir: string,
  specVersion: string = CURRENT_SPEC_VERSION,
): Promise<void> {
  const dirAbs = resolve(dir);
  await mkdir(dirAbs, { recursive: true });
  await writeFile(join(dirAbs, 'note.smd'), smdText, 'utf8');
  const manifest = createDefaultManifest(specVersion);
  await writeFile(
    join(dirAbs, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

/** Zips up an existing bundle directory. Reuses `openDirBundle` + `exportZipBundle` from `./zip`. */
export async function dirToZip(rootDir: string): Promise<Uint8Array> {
  return exportZipBundle(openDirBundle(rootDir));
}

/**
 * Extracts a zip bundle into `destDir` (created if missing). Inherits
 * `openZipBundle`'s zip-slip rejection — a tampered zip throws
 * `BundleZipError` before anything is written to disk.
 */
export async function zipToDir(
  bytes: Uint8Array,
  destDir: string,
): Promise<void> {
  const src = openZipBundle(bytes); // throws BundleZipError on unsafe entries
  await mkdir(resolve(destDir), { recursive: true });
  const dest = openDirBundle(destDir);
  for (const path of await src.list()) {
    const data = await src.read(path);
    if (data !== undefined) await dest.write(path, data);
  }
}
