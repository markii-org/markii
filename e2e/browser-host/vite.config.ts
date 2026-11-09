import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A consumer of the packed @markii/* packages needs no special Vite
// configuration for `@markii/host/browser`: see the report for the dev and
// preview findings that this file is the evidence for.
export default defineConfig({
  plugins: [react()],
  build: { target: 'es2022' },
  server: { host: '127.0.0.1', port: 5301, strictPort: true },
  preview: { host: '127.0.0.1', port: 5301, strictPort: true },
});
