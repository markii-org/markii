import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../scripts/workspace-aliases.config.ts';

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // The run-path probe spawns a real worker thread plus wasmoon's WASM
    // Lua engine, which is slow to start; Vitest's default per-test timeout
    // is too tight for that suite (see run-note.probe.test.ts's own
    // per-test override for the exact figure).
    testTimeout: 10_000,
  },
});
