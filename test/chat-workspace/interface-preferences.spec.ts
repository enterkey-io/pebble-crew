import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installFixture } from './fixtures';

test.use({ serviceWorkers: 'block' });
async function openGeneral(page: import('@playwright/test').Page) {
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Your account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

test('General appearance follows the system or an explicit choice, persists and themes the installed screens', async ({
  page,
  context,
}, info) => {
  await installFixture(context);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await openGeneral(page);
  const appearance = page.getByRole('combobox', { name: 'Appearance', exact: true });
  await expect(appearance).toContainText('System');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await appearance.click();
  await page.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openGeneral(page);
  await expect(appearance).toContainText('Dark');
  await appearance.click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 249, 246)');
  await expect(page.locator('[data-slot="select-content"]')).toHaveCount(0);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('general-light.png') });
  await page.getByRole('button', { name: 'Close Settings', exact: true }).click();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  await page.screenshot({ animations: 'disabled', path: info.outputPath('chat-light.png') });
  if (page.viewportSize()!.width < 768)
    await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New pebble', exact: true }).click();
  await page.getByRole('button', { name: 'Add existing Hermes agent', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Available Hermes agents' })).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: info.outputPath('agent-picker-light.png'),
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('sidebar resizes from its edge, keeps row contents inside, supports keyboard and remembers its width', async ({
  page,
  context,
}, info) => {
  test.skip(page.viewportSize()!.width < 768, 'Phones use the navigation drawer.');
  await installFixture(context);
  await page.goto('/');
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  const rail = page.getByRole('complementary', { name: 'Pebbles and crews', exact: true });
  const handle = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
  await expect(rail).toHaveCSS('width', '352px');
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
  await page.mouse.down();
  await page.mouse.move(700, bounds.y + 100, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await rail.boundingBox())!.width).toBeGreaterThan(650);
  const expanded = (await rail.boundingBox())!.width;
  await expect
    .poll(() => page.evaluate(() => Number(localStorage.getItem('pebble-crew.sidebar-width'))))
    .toBeGreaterThan(650);
  const containment = await page.locator('.pebble-row').evaluateAll((rows) =>
    rows.every((row) => {
      const boundary = row.getBoundingClientRect();
      return [...row.querySelectorAll('[data-slot="item-content"], .pc-overflow')].every(
        (child) => {
          const box = child.getBoundingClientRect();
          return box.left >= boundary.left && box.right <= boundary.right;
        },
      );
    }),
  );
  expect(containment).toBe(true);
  await page.screenshot({ animations: 'disabled', path: info.outputPath('sidebar-expanded.png') });
  await page.reload();
  await expect(page.getByLabel('Message', { exact: true })).toBeEnabled();
  expect(Math.abs((await rail.boundingBox())!.width - expanded)).toBeLessThan(2);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await rail.boundingBox())!.width).toBeLessThan(expanded);
  await handle.dblclick();
  await expect(rail).toHaveCSS('width', '352px');
});
