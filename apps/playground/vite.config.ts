import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { workspaceAliases } from '../../scripts/workspace-aliases.config.ts';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  resolve: { alias: workspaceAliases },
});
