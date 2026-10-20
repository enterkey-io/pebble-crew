import { defineConfig } from '@playwright/test';
export default defineConfig({
  outputDir: 'test-results/owner',
  testDir: 'test/owner-browser',
  timeout: 90000,
  workers: 1,
  use: {
    colorScheme: 'dark',
    serviceWorkers: 'block',
    baseURL: 'https://127.0.0.1:5445',
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    ...(process.env.BOT_WEB_TEST_CHROMIUM
      ? { launchOptions: { executablePath: process.env.BOT_WEB_TEST_CHROMIUM } }
      : {}),
  },
});
