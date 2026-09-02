/**
 * `.mkp` pack archives (docs/packs.md, issue #16): a zip of a pack's
 * PREBUILT form, files at the zip root — `pack.json`, `webview.js`,
 * `webview.css` when the pack has styles, `scripts/` when the pack ships
 * shared Lua. This is the reader half: given the raw bytes of a `.mkp`
 * file, validate it and expose its contents for read-only loading.
 *
 * A `.mkp` is prebuilt-only, on purpose (docs/packs.md's "Two ways to run a
 * pack: prebuilt and from source"): this module never compiles anything. A
 * `webview.js` at the archive root is REQUIRED — an archive that ships only
 * component sources is not a valid `.mkp`, because there would be nothing
 * for a host to load without running a compiler, and `.mkp` exists
 * precisely for hosts that may not carry one.
 *
 * This reader reuses `@markii/bundle`'s zip reader (`openZipBundle`)
 * rather than re-implementing zip parsing or a path jail: AGENTS.md calls a
 * reimplemented jail a bug. `openZipBundle` already rejects a `../`
 * segment, an absolute path, a backslash path, or a Windows drive-letter
 * path in any entry name (zip-slip), and bounds both a single entry's and
 * the whole archive's declared uncompressed size before any bytes are
 * inflated (the zip-bomb guard) — see `packages/markii-bundle/src/zip.ts`.
 * Reusing it means a `.mkp` gets the exact same `bounded-open` guarantee a
 * `.mkz` bundle gets, with no second implementation to drift out of sync.
 *
 * This module never touches a real filesystem: it takes bytes in and
 * returns parsed, in-memory contents (or a structured error) out. It never
 * writes anything anywhere, so "nothing is written outside the pack
 * directory" holds structurally for every rejection path — there is no
 * write side to leak from. A host that wants to install a `.mkp` (unzip it
 * into its own pack directory) is a separate, host-specific concern (the
 * brief's "Install pack from file" command) and is out of this module's
 * scope entirely.
 */
import {
  BundleZipError,
  DEFAULT_MAX_ZIP_ENTRY_BYTES,
  DEFAULT_MAX_ZIP_TOTAL_BYTES,
  openZipBundle,
} from '@markii/bundle';
import { parsePackManifest } from './manifest.js';
import type { PackManifest } from './manifest.js';

/** The archive-root entry names the prebuilt contract reserves. */
const MANIFEST_ENTRY = 'pack.json';
const SCRIPT_ENTRY = 'webview.js';
const STYLESHEET_ENTRY = 'webview.css';
const SCRIPTS_DIR_PREFIX = 'scripts/';

/** Options bounding how much a single `.mkp` open is willing to materialize. Defaults match `@markii/bundle`'s own zip-bomb guard, since a pack archive is bounded the same way a bundle is. */
export interface OpenPackArchiveOptions {
  maxEntryBytes?: number;
  maxTotalBytes?: number;
}

/**
 * Why an `openPackArchive` call failed. `kind: 'zip'` covers everything
 * `openZipBundle` itself rejects (a path-escaping entry, an oversized
 * entry, a corrupt or malformed zip, ZIP64, a CRC mismatch, a name
 * collision) — the message is already loud and specific, so it is passed
 * through rather than re-summarized. `kind: 'manifest'` covers a
 * `pack.json` that parses to invalid JSON or fails `parsePackManifest`.
 * `kind: 'missing-entry'` covers a `.mkp` that lacks a required root entry.
 */
export type PackArchiveError =
  | { kind: 'zip'; message: string }
  | { kind: 'manifest'; errors: string[] }
  | { kind: 'missing-entry'; entry: string; message: string };

export type OpenPackArchiveResult =
  | { ok: true; archive: PackArchiveContents }
  | { ok: false; error: PackArchiveError };

/** The validated, read-only contents of a `.mkp` archive. */
export interface PackArchiveContents {
  /** The parsed, validated `pack.json`. */
  readonly manifest: PackManifest;
  /** Forward-compatible warnings from parsing `pack.json` (unknown keys etc.) — see `parsePackManifest`. */
  readonly manifestWarnings: readonly string[];
  /** The prebuilt registration script's bytes (`webview.js`, always present — see this module's doc comment). */
  readonly scriptBytes: Uint8Array;
  /** The prebuilt stylesheet's bytes (`webview.css`), present only when the pack ships one. */
  readonly stylesheetBytes?: Uint8Array;
  /** Shared Lua modules under `scripts/`, keyed by their path relative to that folder (e.g. `"http.lua"` for `scripts/http.lua`). Empty when the pack ships none. */
  readonly scriptModules: Readonly<Record<string, Uint8Array>>;
  /**
   * Archive-root entries present in the zip but outside the prebuilt
   * contract (e.g. a leftover component source alongside the compiled
   * script, or an entry nested under a subfolder rather than at the zip
   * root). Never an error: `.mkp` follows the same "prebuilt wins,
   * anything else is ignored" posture a pack folder already has for a
   * `webview.js` sitting beside sources. A host's diagnostics surface may
   * report these; this module only supplies the facts.
   */
  readonly ignoredEntries: readonly string[];
}

function isScriptModulePath(path: string): boolean {
  return (
    path.startsWith(SCRIPTS_DIR_PREFIX) &&
    path.length > SCRIPTS_DIR_PREFIX.length
  );
}

/**
 * Decodes UTF-8 bytes, rejecting anything that is not well-formed UTF-8
 * rather than silently substituting replacement characters (the default
 * `TextDecoder` behavior) — a `pack.json` that decodes to mangled text
 * should fail loudly as a manifest problem, not parse whatever garbled JSON
 * `�` substitution happens to produce.
 */
function decodeUtf8Strict(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Opens a `.mkp` archive from its raw bytes and validates it against the
 * prebuilt-pack contract. Never throws: every failure — a hostile or
 * corrupt zip, a missing required entry, an invalid `pack.json` — comes
 * back as `{ ok: false, error }` rather than an exception, so a caller can
 * report the reason without a `try`/`catch` of its own.
 */
export async function openPackArchive(
  bytes: Uint8Array,
  options: OpenPackArchiveOptions = {},
): Promise<OpenPackArchiveResult> {
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ZIP_ENTRY_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_ZIP_TOTAL_BYTES;

  let storage;
  try {
    storage = openZipBundle(bytes, { maxEntryBytes, maxTotalBytes });
  } catch (err) {
    if (err instanceof BundleZipError) {
      return { ok: false, error: { kind: 'zip', message: err.message } };
    }
    return {
      ok: false,
      error: {
        kind: 'zip',
        message: `pack archive rejected: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const paths = await storage.list();

  if (!paths.includes(MANIFEST_ENTRY)) {
    return {
      ok: false,
      error: {
        kind: 'missing-entry',
        entry: MANIFEST_ENTRY,
        message: `pack archive rejected: no "${MANIFEST_ENTRY}" entry at the archive root`,
      },
    };
  }
  if (!paths.includes(SCRIPT_ENTRY)) {
    return {
      ok: false,
      error: {
        kind: 'missing-entry',
        entry: SCRIPT_ENTRY,
        message: `pack archive rejected: no "${SCRIPT_ENTRY}" entry at the archive root: a .mkp carries a pack's prebuilt form only, never its sources, so a compiled ${SCRIPT_ENTRY} is required`,
      },
    };
  }

  const manifestBytes = await storage.read(MANIFEST_ENTRY);
  // Not reachable in practice (the entry was just confirmed present in the
  // same storage instance's own listing), but `read` is typed to return
  // `undefined` and this keeps the function honestly total rather than
  // asserting past the type.
  if (manifestBytes === undefined) {
    return {
      ok: false,
      error: {
        kind: 'missing-entry',
        entry: MANIFEST_ENTRY,
        message: `pack archive rejected: "${MANIFEST_ENTRY}" could not be read`,
      },
    };
  }

  const manifestText = decodeUtf8Strict(manifestBytes);
  if (manifestText === undefined) {
    return {
      ok: false,
      error: {
        kind: 'manifest',
        errors: [`"${MANIFEST_ENTRY}" is not valid UTF-8`],
      },
    };
  }

  const parsed = parsePackManifest(manifestText);
  if (!parsed.ok) {
    return { ok: false, error: { kind: 'manifest', errors: parsed.errors } };
  }

  const scriptBytes = await storage.read(SCRIPT_ENTRY);
  if (scriptBytes === undefined) {
    return {
      ok: false,
      error: {
        kind: 'missing-entry',
        entry: SCRIPT_ENTRY,
        message: `pack archive rejected: "${SCRIPT_ENTRY}" could not be read`,
      },
    };
  }

  let stylesheetBytes: Uint8Array | undefined;
  if (paths.includes(STYLESHEET_ENTRY)) {
    stylesheetBytes = await storage.read(STYLESHEET_ENTRY);
  }

  const scriptModules: Record<string, Uint8Array> = Object.create(
    null,
  ) as Record<string, Uint8Array>;
  const ignoredEntries: string[] = [];

  for (const path of paths) {
    if (
      path === MANIFEST_ENTRY ||
      path === SCRIPT_ENTRY ||
      path === STYLESHEET_ENTRY
    ) {
      continue;
    }
    if (isScriptModulePath(path)) {
      const data = await storage.read(path);
      if (data !== undefined) {
        scriptModules[path.slice(SCRIPTS_DIR_PREFIX.length)] = data;
      }
      continue;
    }
    ignoredEntries.push(path);
  }

  return {
    ok: true,
    archive: {
      manifest: parsed.manifest,
      manifestWarnings: parsed.warnings,
      scriptBytes,
      ...(stylesheetBytes !== undefined ? { stylesheetBytes } : {}),
      scriptModules,
      ignoredEntries,
    },
  };
}

/**
 * The archive naming rule for a PRODUCED `.mkp`: `<name>-<version>.mkp`
 * when `pack.json` declares a `version`, or `<name>.mkp` when it does not.
 *
 * `version` is optional in the manifest (see `PackManifest`'s doc comment)
 * and its absence is valid, not an error — so a produced archive's name
 * must stay valid too. Falling back to the bare pack name rather than
 * inventing a placeholder version (`0.0.0`, `unversioned`, ...) avoids
 * claiming a version the manifest never declared: the filename says exactly
 * as much as the manifest does, no more.
 *
 * Both `name` and a present `version` are already validated by
 * `parsePackManifest` (lowercase-kebab; plain `MAJOR.MINOR.PATCH` digits
 * and dots) before this function ever sees them, so no further escaping is
 * needed to use them as a filename.
 */
export function packArchiveFileName(
  manifest: Pick<PackManifest, 'name' | 'version'>,
): string {
  return manifest.version === undefined
    ? `${manifest.name}.mkp`
    : `${manifest.name}-${manifest.version}.mkp`;
}
