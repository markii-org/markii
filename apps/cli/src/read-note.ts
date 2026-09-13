/**
 * Resolves a path argument (given on the command line) into a note's text,
 * plus its bundle storage when the path names a bundle rather than a bare
 * `.mk.md` file. Every bundle-relative read goes through `@markii/bundle`'s
 * own path-jailed `BundleStorage`: this module never builds a path by
 * string concatenation, and it never reimplements the jail.
 *
 * Never throws: every failure comes back as `{ ok: false, message }`, and
 * the caller (`main.ts`) maps that to exit code 1 with a one-line message.
 */
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  normalizeBundlePath,
  openZipBundle,
  parseManifest,
  type BundleManifest,
  type BundleStorage,
} from '@markii/bundle';
import { openDirBundle } from '@markii/bundle/fs';

/** The conventional entry-note path inside a bundle when the manifest doesn't name one (docs/bundles.md). */
export const DEFAULT_BUNDLE_DOCUMENT_PATH = 'note.mk.md';

const MANIFEST_PATH = 'manifest.json';

export interface ResolvedBundle {
  readonly manifest: BundleManifest;
  readonly storage: BundleStorage;
  /** Present only for the directory form, so `run-note.ts` can reopen it to persist `.cache/` writes. */
  readonly rootDir?: string;
  readonly form: 'directory' | 'zip';
}

export interface ResolvedNote {
  readonly text: string;
  readonly bundle?: ResolvedBundle;
}

export type ReadNoteResult =
  | { readonly ok: true; readonly note: ResolvedNote }
  | { readonly ok: false; readonly message: string };

/** Resolves `manifest.document` (or the convention default) to a bundle-relative path, jailed through `normalizeBundlePath`. `undefined` when the manifest names something that isn't a safe bundle-relative path. */
function resolveDocumentPath(manifest: BundleManifest): string | undefined {
  const raw = manifest.document;
  if (raw === undefined) return DEFAULT_BUNDLE_DOCUMENT_PATH;
  if (typeof raw !== 'string') return undefined;
  const normalized = normalizeBundlePath(raw);
  return normalized.ok ? normalized.path : undefined;
}

async function readBundleNote(
  storage: BundleStorage,
  form: 'directory' | 'zip',
  rootDir: string | undefined,
): Promise<ReadNoteResult> {
  const manifestBytes = await storage.read(MANIFEST_PATH);
  if (manifestBytes === undefined) {
    return { ok: false, message: 'bundle has no manifest.json' };
  }
  let manifestText: string;
  try {
    manifestText = new TextDecoder('utf-8', { fatal: false }).decode(
      manifestBytes,
    );
  } catch {
    return { ok: false, message: 'manifest.json is not valid UTF-8' };
  }
  const parsed = parseManifest(manifestText);
  if (!parsed.ok) {
    return {
      ok: false,
      message: `manifest.json is invalid: ${parsed.errors.join('; ')}`,
    };
  }

  const documentPath = resolveDocumentPath(parsed.manifest);
  if (documentPath === undefined) {
    return {
      ok: false,
      message: `manifest "document" field (${JSON.stringify(parsed.manifest.document)}) is not a valid bundle-relative path`,
    };
  }

  const documentBytes = await storage.read(documentPath);
  if (documentBytes === undefined) {
    return { ok: false, message: `bundle has no ${documentPath}` };
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(documentBytes);

  return {
    ok: true,
    note: {
      text,
      bundle: {
        manifest: parsed.manifest,
        storage,
        form,
        ...(rootDir !== undefined ? { rootDir } : {}),
      },
    },
  };
}

/** `true` for a path ending in `.mkz` or the legacy `.mkbundle` spelling (case-insensitive). */
function isZipBundlePath(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === '.mkz' || ext === '.mkbundle';
}

/**
 * Resolves `filePath`: a `.mk.md` file (read as plain text, no bundle), a
 * directory (opened as a bundle via `@markii/bundle/fs`'s `openDirBundle`),
 * or a `.mkz`/`.mkbundle` file (opened as a bundle via `openZipBundle`).
 * Never throws.
 */
export async function readNote(filePath: string): Promise<ReadNoteResult> {
  let stats;
  try {
    stats = await stat(filePath);
  } catch {
    return { ok: false, message: `cannot read ${filePath}` };
  }

  if (stats.isDirectory()) {
    return readBundleNote(openDirBundle(filePath), 'directory', filePath);
  }

  if (isZipBundlePath(filePath)) {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(filePath);
    } catch {
      return { ok: false, message: `cannot read ${filePath}` };
    }
    let storage: BundleStorage;
    try {
      storage = openZipBundle(bytes);
    } catch (err) {
      return {
        ok: false,
        message: `${filePath} is not a valid Markii bundle: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return readBundleNote(storage, 'zip', undefined);
  }

  let text: string;
  try {
    text = await readFile(filePath, 'utf-8');
  } catch {
    return { ok: false, message: `cannot read ${filePath}` };
  }
  return { ok: true, note: { text } };
}
