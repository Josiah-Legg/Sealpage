import { defineConfig } from '@playwright/test';

/** End-to-end tests drive the built Electron app (run `npm run build` first; `npm run test:e2e` does). */
export default defineConfig({
  testDir: '.',
  testMatch: ['e2e/**/*.spec.ts', 'notrace/**/*.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results',
});
