import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  outputDir: 'test-results/mobile',
  testDir: 'test/mobile',
  timeout: 60000,
  workers: 1,
  use: { colorScheme: 'dark', baseURL: 'http://127.0.0.1:8097', trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'node scripts/serve-static.mjs',
    env: {
      BOT_WEB_STATIC_PORT: '8097',
      BOT_WEB_STATIC_DIRECTORY: resolve(
        process.env.WORKSPACE_BUILD_ROOT ?? 'apps/web/dist',
        process.env.WORKSPACE_BUILD_ROOT ? 'web' : '',
      ),
    },
    url: 'http://127.0.0.1:8097/',
    reuseExistingServer: !process.env.CI,
  },
});
