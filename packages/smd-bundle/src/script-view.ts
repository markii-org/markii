import { ScriptCapabilityError } from './errors';
import { isWriteAllowed } from './paths';
import type { BundleManifest } from './manifest';
import type { BundleStorage } from './storage';

/**
 * The capability-restricted view of a bundle a future Lua runtime (§8, §10,
 * §11) will actually receive — never the raw `BundleStorage`. Deliberately
 * exposes only `read` / `write` / `exists`, no `list`: directory
 * enumeration stays host-side. An untrusted script that can already read
 * `assets/photo.png` by name doesn't need the ability to *discover* every
 * other file in the bundle; keeping `list` off the script-facing surface
 * minimizes what a script can learn about a bundle it wasn't specifically
 * pointed at (e.g. other cached datasets, other scripts' outputs).
 */
export interface ScriptView {
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/**
 * Builds a `ScriptView` over `storage`, gated by `manifest.permissions.bundle`:
 *
 * - No grants at all: every call throws `ScriptCapabilityError`.
 * - `'read'` granted: `read`/`exists` work bundle-wide; `write` still fails.
 * - `'write:cache/'` granted: `write` works, but only for paths
 *   `isWriteAllowed` accepts — `cache/` only. Critically, this holds even
 *   if a hostile manifest lists `'write:cache/'` and the script asks for
 *   `manifest.json` or `note.smd`: `isWriteAllowed` denies those two paths
 *   unconditionally, regardless of what the manifest grants (see `./paths`).
 */
export function createScriptView(
  storage: BundleStorage,
  manifest: BundleManifest,
): ScriptView {
  const grants = manifest.permissions?.bundle ?? [];
  const canRead = grants.includes('read');

  return {
    async read(path) {
      if (!canRead) {
        throw new ScriptCapabilityError(
          `script has no "read" bundle permission (requested "${path}")`,
        );
      }
      return storage.read(path);
    },
    async write(path, data) {
      if (!isWriteAllowed(path, { grants })) {
        throw new ScriptCapabilityError(`script may not write "${path}"`);
      }
      await storage.write(path, data);
    },
    async exists(path) {
      if (!canRead) {
        throw new ScriptCapabilityError(
          `script has no "read" bundle permission (requested "${path}")`,
        );
      }
      return storage.exists(path);
    },
  };
}
