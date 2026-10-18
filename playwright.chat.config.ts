import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
export default defineConfig({
  outputDir: 'test-results/chat',
  testDir: 'test/chat-workspace',
  timeout: 60000,
  workers: 1,
  use: {
    colorScheme: 'dark',
    serviceWorkers: 'block',
    baseURL: 'http://127.0.0.1:8093',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    ...(process.env.BOT_WEB_TEST_CHROMIUM
      ? { launchOptions: { executablePath: process.env.BOT_WEB_TEST_CHROMIUM } }
      : {}),
  },
  webServer: {
    command: 'node scripts/serve-static.mjs',
    env: {
      BOT_WEB_STATIC_PORT: '8093',
      BOT_WEB_STATIC_DIRECTORY: resolve(
        process.env.WORKSPACE_BUILD_ROOT ?? 'apps/web/dist',
        process.env.WORKSPACE_BUILD_ROOT ? 'web' : '',
      ),
    },
    url: 'http://127.0.0.1:8093/',
    reuseExistingServer: !process.env.CI,
  },
});
