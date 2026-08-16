import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../../scripts/workspace-aliases.config.ts';

export default defineConfig({
  resolve: { alias: workspaceAliases },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
