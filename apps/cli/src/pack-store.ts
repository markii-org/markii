/**
 * Where this CLI's packs come from, and nowhere else. A terminal pack runs
 * inside the CLI's own process with all of the user's permissions, so the
 * list of places it can be loaded from is short and fixed:
 *
 * - the device-local install store, a `packs` folder next to the grant
 *   store (`grant-store.ts`'s `grantStoreDirectory`), one folder per
 *   namespace, written only by `markii pack install`;
 * - the bundled packs, a `packs` folder next to the CLI's own entry
 *   (`dist/packs`), built with the CLI.
 *
 * Never a note, a bundle, the working directory, or an environment
 * variable beyond the one the config directory is already derived from.
 * `main.ts` resolves the real values; this module takes them as arguments.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grantStoreDirectory } from './grant-store.js';
import type { CliPackOptions } from './host-adapter.js';

/** The names of the packs the CLI ships. An install may not claim one. */
export const BUNDLED_PACK_NAMESPACES: ReadonlySet<string> = new Set([
  'read',
  'dash',
  'prep',
]);

/** The install store: `<config dir>/packs`. Pure: reads neither the environment nor the platform. */
export function packStoreDirectory(
  env: Record<string, string | undefined>,
  platform: string,
): string {
  return path.join(grantStoreDirectory(env, platform), 'packs');
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** The bundled packs folder beside the built CLI, or `undefined` when there is none (an unbundled dev or test run). */
export function bundledPacksDirectory(): string | undefined {
  const bundled = path.join(here, 'packs');
  return existsSync(bundled) ? bundled : undefined;
}

/** The `CliPackOptions` for a real invocation. */
export function resolveCliPackOptions(
  env: Record<string, string | undefined>,
  platform: string,
): CliPackOptions {
  const bundledRoot = bundledPacksDirectory();
  return {
    installRoot: packStoreDirectory(env, platform),
    ...(bundledRoot !== undefined ? { bundledRoot } : {}),
    reservedNamespaces: BUNDLED_PACK_NAMESPACES,
  };
}
