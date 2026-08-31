/**
 * The `obsidian`-free half of embedding a note's images into its export
 * (GitHub issue #28 slice 3, part 1). `@markii/host`'s `image-embed.ts`
 * owns the size cap, the MIME rules, and the base64 encoding; this module
 * owns the one decision that is specific to this host: how an `<img src>`
 * written in a note resolves to a real file in the vault.
 *
 * THE RESOLUTION ORDER, matching how Obsidian's own preview resolves an
 * image: `app.metadataCache.getFirstLinkpathDest` first, since that is
 * how Obsidian resolves a bare file name or a relative link from anywhere
 * in the vault; a plain vault-relative path second, for a source that
 * already names a real path Obsidian's link index does not recognize.
 *
 * FOUR SMALL SEAMS, NOT A VAULT. `main.ts` is the only file allowed to
 * import `obsidian` outside a short allowlist, so this module never touches
 * `app` directly. It takes four plain functions instead: the link
 * resolver, an existence check, a size check, and a binary read. That
 * keeps the resolution order, the size-before-read decision, and the
 * error handling unit-testable against an in-memory fake vault, with
 * `main.ts` supplying only the four one-line Obsidian calls.
 *
 * THE JAIL. Every path this reads comes from Obsidian's own vault adapter,
 * which is jailed to the vault by construction: a plugin cannot make it
 * read outside the vault it was handed. There is no separate path check
 * here because there is nothing left to jail against.
 */
import { MAX_EMBEDDED_IMAGE_BYTES } from '@markii/host';
import type { ExportImageReader, ExportImageResult } from '@markii/host';

/** `app.metadataCache.getFirstLinkpathDest(src, notePath)`, returning the resolved vault path or `undefined` when nothing matches. */
export type LinkpathResolver = (
  src: string,
  notePath: string,
) => string | undefined;

/** `app.vault.adapter.exists(path)`, the fallback resolution when link resolution finds nothing. */
export type VaultPathExists = (path: string) => Promise<boolean>;

/** `app.vault.adapter.stat(path)`, reduced to the byte size, or `undefined` when the path cannot be statted. */
export type VaultStatSize = (path: string) => Promise<number | undefined>;

/** `app.vault.adapter.readBinary(path)`, already normalized to bytes. Expected to throw on failure; the caller catches it. */
export type VaultReadBinary = (path: string) => Promise<Uint8Array>;

/** The four vault-touching functions this module needs, all one-liners in `main.ts`. */
export interface VaultImageReaderDeps {
  readonly linkpathDest: LinkpathResolver;
  readonly pathExists: VaultPathExists;
  readonly statSize: VaultStatSize;
  readonly readBinary: VaultReadBinary;
}

/** The verbatim reason for a thrown value, for the diagnostics surface only. */
function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolves `src` to a vault path, `getFirstLinkpathDest` first and a plain
 * vault-relative path second. `undefined` when neither resolves.
 */
export async function resolveVaultImagePath(
  src: string,
  notePath: string,
  deps: Pick<VaultImageReaderDeps, 'linkpathDest' | 'pathExists'>,
): Promise<string | undefined> {
  const viaLinkpath = deps.linkpathDest(src, notePath);
  if (viaLinkpath !== undefined) return viaLinkpath;
  const exists = await deps.pathExists(src);
  return exists ? src : undefined;
}

/**
 * Builds the `ExportImageReader` for one note, bound to that note's own
 * path so a relative image source resolves against the note that wrote
 * it, matching `@markii/host`'s `ExportImageReader` seam
 * (`packages/markii-host/src/export/image-embed.ts`).
 *
 * The size is checked before any byte is read: a source that resolves to
 * a file over `MAX_EMBEDDED_IMAGE_BYTES` is reported `oversize` from the
 * stat alone, so this never loads a huge file into memory just to reject
 * it. A source that does not resolve, or a stat or read that fails, is
 * reported `unreadable` with the plain reason. Never throws: every
 * failure this can observe is turned into a result, and a `readBinary`
 * that throws unexpectedly is still caught by
 * `@markii/host`'s `embedImagesInHtml`, which is the caller of this
 * reader.
 */
export function createVaultImageReader(
  notePath: string,
  deps: VaultImageReaderDeps,
): ExportImageReader {
  return async function readVaultImage(
    src: string,
  ): Promise<ExportImageResult> {
    const resolvedPath = await resolveVaultImagePath(src, notePath, deps);
    if (resolvedPath === undefined) {
      return {
        kind: 'unreadable',
        detail: `no file in the vault matches ${src}`,
      };
    }

    let size: number | undefined;
    try {
      size = await deps.statSize(resolvedPath);
    } catch (error) {
      return { kind: 'unreadable', detail: detailOf(error) };
    }
    if (size === undefined) {
      return {
        kind: 'unreadable',
        detail: `could not read the size of ${resolvedPath}`,
      };
    }
    if (size > MAX_EMBEDDED_IMAGE_BYTES) {
      return { kind: 'oversize', byteLength: size };
    }

    try {
      const bytes = await deps.readBinary(resolvedPath);
      return { kind: 'bytes', bytes };
    } catch (error) {
      return { kind: 'unreadable', detail: detailOf(error) };
    }
  };
}
