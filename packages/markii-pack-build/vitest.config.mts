import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../scripts/workspace-aliases.config.ts';

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // These suites boot real worker threads, a real Lua wasm runtime, and
    // real HTTP servers. Vitest's 5s default is the same order of magnitude
    // as the script deadlines under test (`timeoutMs: 5000`), so on a loaded
    // machine the harness could time a test out before its own assertion ran.
    // This raises only the HARNESS budget: every deadline actually under
    // test is the `timeoutMs` passed to spawnRun, and the watchdog tests
    // keep their own explicit, much tighter budgets.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
