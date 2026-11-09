import { defineConfig, devices } from '@playwright/test';
import { APP_PORT, DATA_PORT_A, DATA_PORT_B } from './tests/constants';

/**
 * The browser host suite. `E2E_MODE=dev` serves the app with `vite dev`;
 * the default serves a production build with `vite preview`. Both must
 * pass: the worker and wasm `new URL(..., import.meta.url)` references
 * resolve differently in the two.
 */

const dev = process.env.E2E_MODE === 'dev';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 3,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    {
      command: dev
        ? 'npx vite --port 5301 --strictPort --host 127.0.0.1'
        : 'npx vite preview --port 5301 --strictPort --host 127.0.0.1',
      url: `http://127.0.0.1:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `node scripts/data-server.mjs ${DATA_PORT_A} allowed`,
      url: `http://127.0.0.1:${DATA_PORT_A}/health`,
      reuseExistingServer: false,
    },
    {
      command: `node scripts/data-server.mjs ${DATA_PORT_B} other`,
      url: `http://127.0.0.1:${DATA_PORT_B}/health`,
      reuseExistingServer: false,
    },
  ],
});
