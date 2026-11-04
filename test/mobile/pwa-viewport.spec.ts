import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installFixture } from '../chat-workspace/fixtures';

test.use({ serviceWorkers: 'block' });

async function bottomGap(page: Page) {
  return page.locator('[data-slot="prompt-input"]').evaluate((node) => {
    return innerHeight - node.getBoundingClientRect().bottom;
  });
}

async function viewport(page: Page, height: number, top = 0, scale = 1) {
  await page.evaluate(
    ({ height, top, scale }) => {
      Object.assign(window.visualViewport!, { height, offsetTop: top, scale });
      window.visualViewport!.dispatchEvent(new Event('resize'));
      window.visualViewport!.dispatchEvent(new Event('scroll'));
    },
    { height, top, scale },
  );
}

test.beforeEach(async ({ page, context }) => {
  await page.addInitScript(() => {
    // Model WebKit's standalone visual viewport losing the status-bar height.
    const match = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = match(query);
      if (query === '(display-mode: standalone)')
        Object.defineProperty(result, 'matches', { value: true });
      return result;
    };
    let height = 0;
    const viewport = Object.assign(new EventTarget(), { offsetTop: 0, scale: 1 });
    Object.defineProperty(viewport, 'height', {
      get: () => height || innerHeight - 62,
      set: (value: number) => {
        height = value;
      },
    });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  });
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
});

test('standalone composer reaches the bottom with a short visual viewport, including after resume', async ({
  page,
}, info) => {
  const shell = page.locator('.pc-shell');
  const height = await page.evaluate(() => innerHeight);
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(height);
  await expect.poll(() => bottomGap(page)).toBeLessThanOrEqual(36);
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('pwa-closed-keyboard.png'),
  });
  await page.getByLabel('Message', { exact: true }).fill('Keep this draft');
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
  });
  await expect.poll(() => bottomGap(page)).toBeLessThanOrEqual(36);
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('Keep this draft');
  const portrait = page.viewportSize()!;
  await page.setViewportSize({ width: portrait.height, height: portrait.width });
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(portrait.width);
  await page.setViewportSize(portrait);
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(height);
  await expect.poll(() => bottomGap(page)).toBeLessThanOrEqual(36);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('pwa-closed-keyboard-light.png'),
  });
});

test('standalone keyboard uses its visible area, then releases stale height and pan on blur', async ({
  page,
}, info) => {
  const input = page.getByLabel('Message', { exact: true });
  const shell = page.locator('.pc-shell');
  const height = await page.evaluate(() => innerHeight);
  await input.fill('A draft that survives the keyboard');
  const keyboardHeight = height - 300;
  await viewport(page, keyboardHeight, 12);
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(keyboardHeight);
  await expect.poll(async () => (await shell.boundingBox())!.y).toBe(12);
  await expect
    .poll(async () => (await input.boundingBox())!.y + (await input.boundingBox())!.height)
    .toBeLessThan(keyboardHeight + 12);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('pwa-open-keyboard.png') });
  await viewport(page, keyboardHeight / 2, 80, 2);
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(keyboardHeight);
  await viewport(page, keyboardHeight, 12);
  // iOS can leave the old visual viewport in place after the field loses focus.
  await input.blur();
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(height);
  await expect.poll(async () => (await shell.boundingBox())!.y).toBe(0);
  await expect.poll(() => bottomGap(page)).toBeLessThanOrEqual(36);
  await expect(input).toHaveValue('A draft that survives the keyboard');
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('pwa-dismissed-keyboard.png'),
  });
  await input.focus();
  await viewport(page, height - 62);
  await expect.poll(async () => (await shell.boundingBox())!.height).toBe(height);
});
