import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

if (!process.env.WORKSPACE_BUILD_ROOT)
  throw new Error('Build the isolated workbench and set WORKSPACE_BUILD_ROOT.');
export default defineConfig({
  testDir: 'test/system-workbench',
  outputDir: 'test-results/system',
  timeout: 60000,
  workers: 1,
  use: {
    colorScheme: 'dark',
    baseURL: 'http://127.0.0.1:8098',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'iphone', use: { ...devices['iPhone 13'] } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'node scripts/serve-static.mjs',
    env: {
      BOT_WEB_STATIC_PORT: '8098',
      BOT_WEB_STATIC_DIRECTORY: resolve(process.env.WORKSPACE_BUILD_ROOT, 'web'),
    },
    url: 'http://127.0.0.1:8098/system',
    reuseExistingServer: false,
  },
});
