/**
 * The obsidian-free logic behind the "Build Markii pack for distribution"
 * command (issue #15, gap 3): discovering this device's configured packs
 * outside of any open preview, a real `PackDistributionFs` over `node:fs/
 * promises`, and every user-facing string the command reports (a `Notice`
 * plus the matching console detail — this host's two failure homes,
 * AGENTS.md's "clean is not silent").
 *
 * Deliberately its own module rather than folded into `./pack-context.ts`:
 * that module answers "what does the current preview need," loaded once
 * per preview open against an already-resolved `cacheDir`/esbuild paths.
 * This command has no preview open at all — it reads the plugin instance's
 * settings and paths directly (`../main.ts`) — and it distributes an
 * artifact rather than rendering one, so contorting `loadPackContext` into
 * serving both would blur what each already does one thing well.
 *
 * `obsidian`-free (like every other module under `./`), so it stays
 * testable without the `obsidian` module; `../pack-modals.ts` and
 * `../main.ts` are the only Obsidian-facing pieces, both wiring only.
 */
import { access, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import {
  buildPackForDistribution,
  buildPackRegistrationScript,
  createNodeFileReader,
  discoverPacks,
  resolvePackPaths,
} from '@markii/host';
import type {
  ConfirmPackOverwrite,
  DiscoveredPack,
  PackDistributionFs,
  PackDistributionOutcome,
  SkippedPackFolder,
} from '@markii/host';
import {
  PACK_COMPILATION_UNAVAILABLE_NOTICE,
  compilationUnavailableSkipCount,
} from './pack-diagnostics.js';
import { createPackRegistrationBuilder } from './pack-compilation.js';

/** Every pack this device's pack-folder setting names, resolved against the open vault, exactly as `./pack-context.ts`'s `loadPackContext` resolves them — but with no build, no evaluation, no registry: this command only needs to know WHICH packs exist and pick one. */
export interface ConfiguredPacksForCommand {
  readonly packs: readonly DiscoveredPack[];
  readonly skipped: readonly SkippedPackFolder[];
}

/** Discovers the packs named by `configuredFolders` (this plugin's device-local pack-folder setting, unresolved) against `vaultRoot`, for the "Build Markii pack for distribution" command's own use — never throws, matching `discoverPacks`' own posture. */
export async function discoverPacksForCommand(
  configuredFolders: readonly string[],
  vaultRoot: string | undefined,
): Promise<ConfiguredPacksForCommand> {
  const homeDir = homedir();
  const folders = resolvePackPaths(configuredFolders, vaultRoot, homeDir);
  const discovery = await discoverPacks(folders, createNodeFileReader());
  return { packs: discovery.packs, skipped: discovery.skipped };
}

/** The real `PackDistributionFs` (`@markii/host`'s `packs/pack-distribute.ts`) over `node:fs/promises`. Never rejects on a missing file for `exists`/`readFile`, matching every other filesystem seam in this plugin. */
export function createNodePackDistributionFs(): PackDistributionFs {
  return {
    exists: async (absolutePath) => {
      try {
        await access(absolutePath);
        return true;
      } catch {
        return false;
      }
    },
    readFile: async (absolutePath) => {
      try {
        return await readFile(absolutePath, 'utf8');
      } catch {
        return undefined;
      }
    },
    writeFile: async (absolutePath, text) => {
      await writeFile(absolutePath, text, 'utf8');
    },
    deleteFile: async (absolutePath) => {
      await unlink(absolutePath);
    },
  };
}

export interface RunBuildPackForDistributionOptions {
  readonly pack: DiscoveredPack;
  /** The plugin's own pack-cache directory (`../main.ts`'s `packCacheDir`); the build still runs through this normal cache, only the output is copied into the pack's own folder. */
  readonly cacheDir: string;
  readonly esbuildBrowserModulePath: string | undefined;
  readonly esbuildWasmBinaryPath: string | undefined;
  readonly fs: PackDistributionFs;
  readonly confirmOverwrite: ConfirmPackOverwrite;
}

/** One command run's full result: the outcome itself, the `Notice` text, and the console detail lines — both wording homes this host's diagnostics contract requires. */
export interface BuildPackCommandResult {
  readonly outcome: PackDistributionOutcome;
  readonly notice: string;
  readonly consoleLines: readonly string[];
}

/**
 * Compiles `options.pack` through `@markii/host`'s `buildPackForDistribution`
 * and reports the result. Builds through `createPackRegistrationBuilder`
 * (`./pack-compilation.ts`) exactly like a preview's own load path, so a
 * three-file install (no esbuild-wasm beside `main.js`) produces the SAME
 * `packCompilationUnavailableReason` this plugin already uses everywhere
 * else — `noticeFor` below recognizes that reason via the existing
 * `compilationUnavailableSkipCount` predicate and reuses
 * `PACK_COMPILATION_UNAVAILABLE_NOTICE` rather than authoring a second
 * sentence for the same condition.
 */
export async function runBuildPackForDistribution(
  options: RunBuildPackForDistributionOptions,
): Promise<BuildPackCommandResult> {
  const { pack, cacheDir, esbuildBrowserModulePath, esbuildWasmBinaryPath } =
    options;

  const build = createPackRegistrationBuilder({
    esbuildBrowserModulePath,
    esbuildWasmBinaryPath,
    compile: (compilePack, dir) =>
      buildPackRegistrationScript(compilePack, dir, {
        esbuildBrowserModulePath,
        esbuildWasmBinaryPath,
      }),
  });

  const outcome = await buildPackForDistribution({
    pack,
    cacheDir,
    build,
    fs: options.fs,
    confirmOverwrite: options.confirmOverwrite,
  });

  return {
    outcome,
    notice: noticeForOutcome(outcome),
    consoleLines: consoleLinesForOutcome(outcome),
  };
}

/** `Notice` shown when no pack folders are configured at all — the command's own "nothing to build" case, distinct from a folder that is configured but produces zero usable packs (`ConfiguredPacksForCommand.skipped` covers that; `../main.ts` reports it separately). */
export const NO_PACKS_CONFIGURED_NOTICE =
  "Markii: no pack folders are configured. Add one in Markii's settings under Component packs.";

/**
 * The question the overwrite-confirmation modal asks (`../pack-modals.ts`
 * renders it and lists `existingPaths` underneath). It lives here, not in
 * the modal, because AGENTS.md makes this module the ONE home for this
 * command's user-facing wording; the modal is wiring only. The sentence
 * names what is actually there: a pack whose folder holds only a stale
 * `webview.css` must not be told it has a built `webview.js`.
 */
export function overwritePromptMessage(
  packName: string,
  existingPaths: readonly string[],
): string {
  const names = existingPaths.map((entry) => basename(entry));
  const [only, ...rest] = names;
  const subject =
    only === undefined
      ? 'built files'
      : rest.length === 0
        ? only
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
  const pronoun = names.length === 1 ? 'it' : 'them';
  return `Pack ${packName} already has ${subject} in its folder. Overwrite ${pronoun}?`;
}

/** Bytes as whole kilobytes, rounded up, with a floor of 1 KB — a 200-byte script should never read as "0 KB". */
function formatKilobytes(bytes: number): string {
  return `${String(Math.max(1, Math.ceil(bytes / 1024)))} KB`;
}

function writtenNotice(
  outcome: Extract<PackDistributionOutcome, { kind: 'written' }>,
): string {
  const scriptPart = `webview.js is ${formatKilobytes(outcome.scriptBytes)}`;
  const stylesheetPart =
    outcome.stylesheetBytes !== undefined
      ? ` and webview.css is ${formatKilobytes(outcome.stylesheetBytes)}`
      : '';
  return `Markii: built pack "${outcome.packName}" into its folder. ${scriptPart}${stylesheetPart}.`;
}

function cancelledNotice(packName: string): string {
  return `Markii: build cancelled for pack "${packName}". No files were changed.`;
}

function failedNotice(packName: string): string {
  return `Markii: could not build pack "${packName}". Open the developer console for details.`;
}

/**
 * The `Notice` text for one `PackDistributionOutcome` — the quiet marker
 * half of AGENTS.md's "clean is not silent" rule. Exported (rather than
 * kept private to `runBuildPackForDistribution`) so its wording is
 * directly unit-testable without driving a full build through
 * `createPackRegistrationBuilder`/esbuild-wasm.
 */
export function noticeForOutcome(outcome: PackDistributionOutcome): string {
  switch (outcome.kind) {
    case 'written':
      return writtenNotice(outcome);
    case 'cancelled':
      return cancelledNotice(outcome.packName);
    case 'failed':
      // Reuses the existing marker predicate (`./pack-diagnostics.ts`'s
      // `compilationUnavailableSkipCount`) rather than re-matching the
      // reason text directly, so a future reword of
      // `packCompilationUnavailableReason` can't silently break this path.
      if (
        compilationUnavailableSkipCount({
          skipped: [{ reason: outcome.reason }],
        }) > 0
      ) {
        return PACK_COMPILATION_UNAVAILABLE_NOTICE;
      }
      return failedNotice(outcome.packName);
  }
}

/** The full console detail for one `PackDistributionOutcome` — the diagnostic half of AGENTS.md's "clean is not silent" rule: paths, sizes, warnings, or the failure reason verbatim. Exported for the same testability reason as `noticeForOutcome` above. */
export function consoleLinesForOutcome(
  outcome: PackDistributionOutcome,
): string[] {
  switch (outcome.kind) {
    case 'written': {
      const lines = [
        `[markii] built pack "${outcome.packName}"`,
        `[markii]   ${outcome.scriptPath} (${String(outcome.scriptBytes)} bytes)`,
      ];
      if (outcome.stylesheetPath !== undefined) {
        lines.push(
          `[markii]   ${outcome.stylesheetPath} (${String(outcome.stylesheetBytes ?? 0)} bytes)`,
        );
      }
      if (outcome.removedStylesheetPath !== undefined) {
        lines.push(
          `[markii]   removed stale stylesheet ${outcome.removedStylesheetPath}`,
        );
      }
      for (const warning of outcome.warnings) {
        lines.push(`[markii]   ${warning}`);
      }
      return lines;
    }
    case 'cancelled':
      return [`[markii] build cancelled for pack "${outcome.packName}"`];
    case 'failed':
      return [
        `[markii] pack "${outcome.packName}" build failed: ${outcome.reason}`,
      ];
  }
}
