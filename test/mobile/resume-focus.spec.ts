import { submitMessage } from '../composer';
import { test, expect } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';

test.use({ serviceWorkers: 'block' });

test('background and resume leave the mobile composer unfocused with its draft intact', async ({
  page,
  context,
}) => {
  await installFixture(context);
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await expect(field).not.toBeFocused();
  await field.fill('Keep my draft without reopening the keyboard');
  await expect(field).toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
  await expect(field).not.toBeFocused();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(field).toBeEnabled();
  await expect(page.getByRole('progressbar', { name: 'Opening Pebble Crew' })).toHaveCount(0);
  await expect(field).not.toBeFocused();
  await expect(field).toHaveValue('Keep my draft without reopening the keyboard');
  await field.tap();
  await expect(field).toBeFocused();
});

test('a send receipt received in the background never schedules mobile composer focus', async ({
  page,
  context,
}) => {
  await installFixture(context);
  let accept!: () => void;
  const held = new Promise<void>((resolve) => {
    accept = resolve;
  });
  let sending = false;
  await context.route('**/v1/rpc', async (route) => {
    if (route.request().postDataJSON().operation !== 'chat.send') return route.fallback();
    sending = true;
    await held;
    await route.fallback();
  });
  await page.goto('/');
  const field = page.getByLabel('Message', { exact: true });
  await expect(field).toBeEnabled();
  await field.fill('A message sent before switching apps');
  await submitMessage(page);
  await expect.poll(() => sending).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  accept();
  await expect(field).toHaveValue('');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(field).not.toBeFocused();
});
