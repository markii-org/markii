/** Hand-written declarations for `esbuild.options.mjs`, so the Vitest probe (`src/run/browser-worker-bundle.probe.test.ts`) can import the real build options under `tsc --noEmit`. Keep in sync with the exports of that file. */
import type { BuildOptions } from 'esbuild';

export declare const mainBuild: BuildOptions;
export declare const workerBuild: BuildOptions;
export declare function copyWasmGlue(): void;
export declare function copyEsbuildWasm(): void;
