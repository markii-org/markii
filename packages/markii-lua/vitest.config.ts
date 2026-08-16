import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../scripts/workspace-aliases.config.ts';

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // The adversarial suite deliberately runs hostile/runaway Lua (infinite
    // loops, memory balloons, deep recursion). Each case is bounded by its
    // own in-sandbox limits (see limits.ts), but generous outer test/hook
    // timeouts avoid flakiness on a loaded CI box without weakening what's
    // actually being asserted (the sandbox's own limits, not vitest's).
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
