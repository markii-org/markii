/**
 * Whether pack compilation is available at all, and the `PackCompileBuilder`
 * (`./pack-context.ts`) `view.tsx` wires up when it is not.
 *
 * A three-file install (manifest.json/main.js/styles.css, fetched by
 * automated installers such as BRAT) never carries the esbuild-wasm runtime
 * (`esbuild-wasm/lib/browser.js` + `esbuild-wasm/esbuild.wasm`): embedding
 * that ~14 MB runtime into `main.js` alongside the Run path's worker bundle
 * was weighed and rejected (AGENTS.md's Stack section), so only the full
 * zip install carries it. A pack that needs compiling from source simply
 * cannot be compiled on such an install. That is a degraded capability, not
 * an error — but AGENTS.md's "clean is not silent" rule still applies: it
 * must reach both of a failure's two homes exactly like every other pack
 * failure, a `skipped` reason (the full diagnostic, via
 * `packCompilationUnavailableReason`) and a `Notice` (the quiet marker, via
 * `PACK_COMPILATION_UNAVAILABLE_NOTICE`), both defined in
 * `./pack-diagnostics.ts` (the one home for failure wording).
 *
 * This module is obsidian-free (unlike `../view.tsx`, which imports
 * `obsidian` and is deliberately untested) precisely so the branch between
 * "compile" and "cleanly refuse" is unit-testable without a real
 * esbuild-wasm invocation.
 */
import { packCompilationUnavailableReason } from './pack-diagnostics.js';
import type { PackCompileBuilder } from './pack-context.js';

/** The two plugin-relative asset paths a real compile needs — see `../main.ts`'s `esbuildBrowserModulePath`/`esbuildWasmBinaryPath`, each `undefined` when the file is not present beside `main.js`. */
export interface PackCompilationOptions {
  readonly esbuildBrowserModulePath: string | undefined;
  readonly esbuildWasmBinaryPath: string | undefined;
  /**
   * The real builder: `@markii/host`'s `buildPackRegistrationScript`,
   * already bound to the two paths above. Injected so this module needs no
   * esbuild-wasm to test — tests pass a stub and assert it is (or is not)
   * called.
   */
  readonly compile: PackCompileBuilder;
}

/** Whether both esbuild-wasm asset paths are present, i.e. whether a real compile is possible at all. */
export function packCompilationAvailable(
  browserModulePath: string | undefined,
  wasmBinaryPath: string | undefined,
): boolean {
  return browserModulePath !== undefined && wasmBinaryPath !== undefined;
}

/**
 * Returns a `PackCompileBuilder` (`./pack-context.ts`) that delegates to
 * `options.compile` when compilation is available, and otherwise resolves a
 * `'failed'` outcome naming the pack, without ever calling `options.compile`
 * (there is nothing to invoke it with: no esbuild-wasm module to load).
 * Never throws — mirrors every other step `loadPackContext` composes.
 */
export function createPackRegistrationBuilder(
  options: PackCompilationOptions,
): PackCompileBuilder {
  const { esbuildBrowserModulePath, esbuildWasmBinaryPath, compile } = options;
  const available = packCompilationAvailable(
    esbuildBrowserModulePath,
    esbuildWasmBinaryPath,
  );

  return async (pack, cacheDir) => {
    if (!available) {
      return {
        kind: 'failed',
        reason: packCompilationUnavailableReason(pack.manifest.name),
      };
    }
    return compile(pack, cacheDir);
  };
}
