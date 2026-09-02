/** Hand-written declarations for `esbuild.options.mjs`, so the Vitest probe (`src/run/browser-worker-bundle.probe.test.ts`) can import the real build options under `tsc --noEmit`. Keep in sync with the exports of that file. */
import type { BuildOptions } from 'esbuild';

export declare function createMainBuild(): BuildOptions;
export declare const workerBuild: BuildOptions;
export declare function buildEmbeddedAssets(
  overrides?: Partial<BuildOptions>,
): Promise<{
  workerBundleBase64: string;
  wasmGlueBase64: string;
  watchFiles: string[];
}>;
export declare function buildEmbeddedBundledPacks(): Promise<{
  payloadBase64: string;
  watchFiles: string[];
}>;
