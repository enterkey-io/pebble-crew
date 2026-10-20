import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { installFixture, emit, history } from '../chat-workspace/fixtures';
test.use({ serviceWorkers: 'block' });

async function readable(field: Locator) {
  expect(
    await field.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
  ).toBeGreaterThanOrEqual(16);
}

async function contained(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const input = (await page.getByLabel('Message', { exact: true }).boundingBox())!;
  const send = (await page
    .getByRole('button', { name: 'Send message', exact: true })
    .boundingBox())!;
  const viewport = await page.evaluate(() => ({
    top: visualViewport?.offsetTop ?? 0,
    bottom: (visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? innerHeight),
  }));
  expect(input.y).toBeGreaterThanOrEqual(viewport.top);
  expect(input.y + input.height).toBeLessThanOrEqual(viewport.bottom + 1);
  expect(send.y + send.height).toBeLessThanOrEqual(viewport.bottom + 1);
}

test('composer focus uses readable text without disabling user zoom or overflowing the phone', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await readable(input);
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
  expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\D|$)/);
  await input.tap();
  await input.fill('A mobile message');
  const field = (await input.boundingBox())!;
  const send = (await page
    .getByRole('button', { name: 'Send message', exact: true })
    .boundingBox())!;
  expect(send.width).toBeGreaterThanOrEqual(44);
  expect(send.height).toBeGreaterThanOrEqual(44);
  expect(Math.abs(field.y + field.height / 2 - (send.y + send.height / 2))).toBeLessThan(1);
  await contained(page);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('phone-composer.png') });
  await page.getByRole('button', { name: 'Send message', exact: true }).tap();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('log')).toContainText('A mobile message');
});

test('search and pebble fields keep the same mobile text minimum', async ({ page, context }) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Toggle navigation', exact: true }).tap();
  await page.getByRole('button', { name: 'Search Pebble Crew', exact: true }).tap();
  await readable(page.locator('[data-slot="command-input"]'));
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'New', exact: true }).tap();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).tap();
  await page.getByRole('button', { name: 'Create new pebble', exact: true }).tap();
  await readable(page.getByLabel('Name', { exact: true }));
  await readable(page.getByLabel('Title', { exact: true }));
  await readable(page.getByLabel('Description', { exact: true }));
});

test('login fields use readable mobile text', async ({ page, context }) => {
  await installFixture(context);
  await context.route('**/api/auth/get-session', (route) => route.fulfill({ json: null }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  await readable(page.getByLabel('Username', { exact: true }));
  await readable(page.getByLabel('Password', { exact: true }));
});

test('stream completion keeps the whole touch message row in place', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await emit(page, 'message.start');
  const reply = 'Your research is ready.';
  await emit(page, 'message.delta', { text: reply });
  const live = page.locator('[data-message-phase="live"]');
  await expect(live).toBeVisible();
  const element = (await live.elementHandle())!;
  const controls = await live.locator('[data-slot="message-footer"]').innerHTML();
  const time = await live.locator('time').textContent();
  const before = (await live.boundingBox())!.height;
  await page.screenshot({
    animations: 'disabled',
    scale: 'css',
    path: info.outputPath('streaming.png'),
  });
  await page.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation === 'chat.history')
      await route.fulfill({
        json: {
          result: {
            messages: [
              ...history,
              { row_id: 901, role: 'assistant', text: reply, timestamp: '2026-10-16T01:01:00Z' },
            ],
          },
        },
      });
    else await route.fallback();
  });
  await emit(page, 'message.complete', {
    status: 'done',
    persisted_turn: { final_assistant_row_id: 901 },
  });
  const saved = page.locator('[data-message-id="901"]');
  await expect(saved).toBeVisible();
  expect(await element.evaluate((node) => node.isConnected)).toBe(true);
  expect((await saved.boundingBox())!.height).toBeCloseTo(before, 0);
  expect(await saved.locator('time').textContent()).toBe(time);
  expect(await saved.locator('[data-slot="message-footer"] button').count()).toBe(2);
  // Completion may enable the reaction button, but must not introduce another control.
  expect((controls.match(/<button/g) ?? []).length).toBe(2);
  await page.screenshot({
    animations: 'disabled',
    scale: 'css',
    path: info.outputPath('completed.png'),
  });
});

test('visual keyboard resize and pan keep the composer visible and preserve the draft', async ({
  page,
  context,
}, info) => {
  // Desktop automation cannot open an iOS keyboard. Exercise its independent
  // visual-viewport resize/pan events against the real production layout.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: Object.assign(new EventTarget(), { height: 640, offsetTop: 0, scale: 1 }),
    });
  });
  await installFixture(context);
  await page.goto('/');
  const input = page.getByLabel('Message', { exact: true });
  await expect(input).toBeEnabled();
  await input.fill('Keep this draft\n'.repeat(8));
  const draft = await input.inputValue();
  const shell = page.locator('.pc-shell');
  const fullHeight = (await shell.boundingBox())!.height;
  await page.evaluate(() => {
    Object.assign(visualViewport!, { height: 440, offsetTop: 12 });
    visualViewport!.dispatchEvent(new Event('resize'));
    visualViewport!.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(440);
  await expect.poll(async () => (await shell.boundingBox())!.y).toBe(12);
  await contained(page);
  await expect
    .poll(() =>
      page
        .getByRole('log')
        .evaluate((node) => Math.abs(node.scrollHeight - node.scrollTop - node.clientHeight)),
    )
    .toBeLessThan(2);
  expect((await page.getByRole('log').boundingBox())!.height).toBeGreaterThan(100);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('phone-keyboard-layout.png'),
  });
  await page.evaluate(() => {
    Object.assign(visualViewport!, { height: 220, scale: 2, offsetTop: 80 });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await page.waitForTimeout(50);
  expect((await shell.boundingBox())!.height).toBe(440);
  await page.evaluate(() => {
    Object.assign(visualViewport!, { height: 640, offsetTop: 0, scale: 1 });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(fullHeight);
  await expect.poll(async () => (await shell.boundingBox())!.y).toBe(0);
  await expect(input).toHaveValue(draft);
  await contained(page);
  await page.getByRole('log').evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate(() => {
    Object.assign(visualViewport!, { height: 440 });
    visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(440);
  expect(await page.getByRole('log').evaluate((node) => node.scrollTop)).toBe(0);
});
