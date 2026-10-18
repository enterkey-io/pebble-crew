import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';

const temporary = await mkdtemp(resolve(tmpdir(), 'pebble-progress-'));
const script = resolve('scripts/progress/board.mjs');
const env = {
  ...process.env,
  PEBBLE_BOARD_STATE: resolve(temporary, 'state.json'),
  PEBBLE_BOARD_PORT: '0',
};
const output = resolve('.audit/shadcn-implementation');
await mkdir(output, { recursive: true });
let server;
let browser;
function update(...args) {
  execFileSync(process.execPath, [script, ...args], { env });
}
async function launch(port = '0') {
  server = spawn(process.execPath, [script, 'serve'], {
    env: { ...env, PEBBLE_BOARD_PORT: port },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture server did not start')), 5000);
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fixture exited: ${code}`));
    });
    server.stdout.on('data', (data) => {
      const match = String(data).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
  });
}
async function stop() {
  if (server?.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
}
try {
  const base = await launch();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(base);
  await expect(page.locator('#transport')).toHaveAttribute('data-live', 'true');
  await expect(page.locator('.phase')).toHaveCount(10);
  await expect(page.locator('[data-task="dashboard.build"]')).toHaveAttribute(
    'data-state',
    'doing',
  );
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  update('update', 'dashboard.build', 'done', 'Verified update');
  await expect(page.locator('[data-task="dashboard.build"]')).toHaveAttribute('data-state', 'done');
  update('wait', 'dashboard.verify', 'Choose a fixture option <img src=x>');
  await expect(page.locator('#waiting')).toBeVisible();
  await expect(page.locator('#question')).toHaveText('Choose a fixture option <img src=x>');
  await expect(page.locator('#waiting img')).toHaveCount(0);
  update('unwait', 'dashboard.verify');
  await expect(page.locator('#waiting')).toBeHidden();
  await page.getByRole('button', { name: 'Foundation Planned' }).click();
  await expect(page.locator('#phase-title')).toHaveText('Foundation');
  update('update', 'dashboard.verify', 'done', 'Live status checked');
  await expect(page.locator('#count')).toContainText('2 of');
  await expect(page.locator('#phase-title')).toHaveText('Foundation');
  await stop();
  await expect(page.locator('#transport')).toHaveAttribute('data-live', 'false');
  await launch(new URL(base).port);
  await expect(page.locator('#transport')).toHaveAttribute('data-live', 'true', { timeout: 10000 });
  await expect(page.locator('#phase-title')).toHaveText('Foundation');
  expect(navigations).toBe(0);
  expect((await fetch(`${base}/state`, { method: 'POST' })).status).toBe(405);
  expect((await fetch(`${base}/phases.json`)).status).toBe(404);
  const phone = await browser.newPage({
    viewport: { width: 320, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  await phone.goto(base);
  await expect(phone.locator('#transport')).toHaveAttribute('data-live', 'true');
  update('update', 'dashboard.tailnet', 'done', 'Private route verified');
  await expect(phone.locator('#phase-title')).toHaveText('Baseline');
  await expect(page.locator('#phase-title')).toHaveText('Foundation');
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(output, 'dashboard-desktop.png'), fullPage: true });
  await phone.screenshot({ path: resolve(output, 'dashboard-phone.png'), fullPage: true });
  if (process.env.PEBBLE_BOARD_URL) {
    const live = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await live.goto(process.env.PEBBLE_BOARD_URL);
    await expect(live.locator('#transport')).toHaveAttribute('data-live', 'true');
    await expect(live.locator('.phase')).toHaveCount(10);
    await live.screenshot({ path: resolve(output, 'dashboard-tailnet.png'), fullPage: true });
  }
  process.stdout.write(
    'Progress board passed: live updates, escaped owner alert, stable selected phase, reconnect without reload, read-only routes, and 320px layout.\n',
  );
} finally {
  await browser?.close();
  await stop();
  await rm(temporary, { recursive: true, force: true });
}
